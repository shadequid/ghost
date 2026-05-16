/**
 * ObserverLoop — composition root for the unified observer.
 *
 * Single loop, two cadences:
 *   - EVAL  every `tickMs` (default 5s): read in-memory state + PriceCache,
 *           run detection, filter, judge, dispatch. Cheap.
 *   - SYNC  every `syncIntervalMs` (default 60s): REST poll HL for
 *           positions / open orders / fills / historical orders. Refreshes
 *           `cachedRest` in-memory. Throttled separately from eval so the
 *           tick can run 12× per HL poll without spiking REST calls.
 *
 * One tick (eval) does:
 *   1. Confirm-card gate: if any approval pending on the main session,
 *      advance baseline quietly + skip the rest.
 *   2. (Sync sub-step, age-aware): if elapsed since last REST sync ≥
 *      `syncIntervalMs`, refresh `cachedRest`.
 *   3. Read AlertRulesService + PriceCache for crossing detection.
 *   4. Diff against prior persisted snapshot → typed events + fired alert ids.
 *   5. Mark fired rules in AlertRulesService.
 *   6. Filter: skip the LLM call when no structural change happened.
 *   7. Invoke event-judge skill (single LLM call): { decision, body, notify }.
 *   8. On fire: dispatch chat (always) + notification (when notify=true).
 *   9. Persist next evaluated baseline.
 *
 * Wired into the BackgroundJobRunner as `observer` via
 * `src/daemon/jobs/observer.ts`.
 */

import type { Logger } from "pino";
import type { Database } from "bun:sqlite";
import type { Runtime } from "../runtime.js";
import type { Runner } from "../agent/runner.js";
import type { ContextBuilder } from "../agent/context-builder.js";
import type { ITradingClient } from "../services/interfaces/trading-client.js";
import type { AlertRulesService } from "../services/alert-rules.js";
import type { NotificationsService, NotificationKind } from "../services/notifications.js";
import type { PriceCache } from "../services/price-cache.js";
import type { ApprovalManager } from "../gateway/approval.js";
import type { SessionManager } from "../session/manager.js";
import type { EventBus } from "../bus/events.js";
import type { ChannelManager } from "../channels/manager.js";
import type { PairingStore } from "../pairing/store.js";
import type { ObserverConfig } from "../config/schema.js";
import { MAIN_SESSION_KEY } from "../session/session.js";
import {
  ObserverStateStore,
  RECENT_CANCEL_OIDS_CAP,
  RECENT_FILL_IDS_CAP,
  type ObserverSnapshot,
  type PositionSnapshot,
} from "./state-store.js";
import { diffSnapshot } from "./diff.js";
import { fetchSnapshot, type SnapshotInput } from "./snapshot.js";
import type { ObserverEvent } from "./events.js";
import { callJudge, type JudgeResponse } from "./judge.js";
import type { ChatSnippet } from "../daemon/prompts/event-judge.js";
import { dispatchOutbound, type OutboundChannel } from "../channels/index.js";
import { ChannelId } from "../channels/types.js";
import type { Message } from "@mariozechner/pi-ai";

const RECENT_CHAT_MAX = 20;

/**
 * Per-position `pnl_snapshot` rate-limit thresholds. The judge skill
 * already lists a 60-min non-urgent cooldown, but the LLM is not durable
 * across ticks — live evidence showed two PnL chats 33 min apart with
 * Δprice ≈ 0.3% and Δpnl ≈ -$1.2. These constants enforce the floor in
 * code: a `pnl_snapshot` is filtered out of the events array sent to the
 * judge unless at least ONE of the three thresholds below is exceeded.
 *
 * Tuning notes:
 *   - `MIN_PNL_PCT_DELTA = 5` (pct of margin). Picked over USD-delta so the
 *     gate scales with position size — a $1 swing on a 1k margin is noise
 *     but on a 10 USDC margin is +10%.
 *   - `MIN_PRICE_PCT_DELTA = 0.5` (pct of mark price). Tight enough that
 *     real breakouts pass; loose enough that the 5s eval cadence doesn't
 *     wake the judge on every tick.
 *   - `MIN_COOLDOWN_MS = 60 min`. Matches the event-judge skill's
 *     non-urgent cooldown rule so the code floor and the LLM judge agree on
 *     a single source of truth. The original 30-min floor let the literal
 *     bug evidence (33-min gap, 0.3% price move, $1.2 PnL drift) slip the
 *     code-side gate, leaving only the non-durable skill rule to catch it.
 */
export const MIN_PNL_PCT_DELTA = 5;
export const MIN_PRICE_PCT_DELTA = 0.5;
export const MIN_COOLDOWN_MS = 60 * 60 * 1000;

/**
 * Filter `pnl_snapshot` events against per-position last-fired thresholds.
 *
 * For each pnl_snapshot in `events`:
 *   - If the corresponding `priorPositions[key]` has no `lastFired*` quad
 *     (any field null) → keep (first fire is unconstrained).
 *   - Else drop iff ALL of these hold vs the prior fire:
 *       |Δpnl%| < MIN_PNL_PCT_DELTA
 *       |Δprice%| < MIN_PRICE_PCT_DELTA
 *       (nowMs - lastFiredAtMs) < MIN_COOLDOWN_MS
 *   - Any single threshold exceeded → keep (the snapshot reflects a
 *     meaningful change).
 *
 * Non-pnl_snapshot events pass through untouched. Pure helper — exported
 * for unit-test coverage.
 */
export function filterPnlSnapshots(
  events: ObserverEvent[],
  priorPositions: Record<string, PositionSnapshot>,
  nowMs: number,
): ObserverEvent[] {
  return events.filter((ev) => {
    if (ev.type !== "pnl_snapshot") return true;
    const key = `${ev.symbol.toUpperCase()}|${ev.side}`;
    const prior = priorPositions[key];
    if (!prior) return true;
    const {
      lastFiredPnlPct,
      lastFiredMarkPrice,
      lastFiredAtMs,
    } = prior;
    if (
      lastFiredPnlPct === null ||
      lastFiredMarkPrice === null ||
      lastFiredAtMs === null ||
      lastFiredMarkPrice === 0
    ) {
      return true; // never fired before — pass through.
    }
    const pnlPctDelta = Math.abs(ev.unrealizedPnlPct - lastFiredPnlPct);
    const pricePctDelta = Math.abs(
      ((ev.markPrice - lastFiredMarkPrice) / lastFiredMarkPrice) * 100,
    );
    const elapsedMs = nowMs - lastFiredAtMs;
    const allBelow =
      pnlPctDelta < MIN_PNL_PCT_DELTA &&
      pricePctDelta < MIN_PRICE_PCT_DELTA &&
      elapsedMs < MIN_COOLDOWN_MS;
    return !allBelow;
  });
}

/**
 * Decide whether the diff result warrants spending an LLM call. The filter
 * is intentionally simple: any structural change in positions, orders,
 * fills, or fired price alerts passes; a bag of `pnl_snapshot` only does
 * not. pnl_snapshot becomes useful CONTEXT for the LLM once another event
 * opens the gate, but it never opens the gate on its own.
 */
export function filterPassesLlm(
  events: ObserverEvent[],
  prior: ObserverSnapshot,
  currentOpenOrderIds: string[],
): boolean {
  for (const ev of events) {
    if (ev.type !== "pnl_snapshot") return true;
  }
  // No non-snapshot events. Check open-order set change as a fallback —
  // an order cancellation doesn't produce a typed event in v1 but is still
  // worth noting if it changes the trader's setup.
  const priorIds = new Set(prior.openOrderIds);
  if (priorIds.size !== currentOpenOrderIds.length) return true;
  for (const id of currentOpenOrderIds) {
    if (!priorIds.has(id)) return true;
  }
  return false;
}

export interface ObserverLoopDeps {
  db: Database;
  config: ObserverConfig;
  tradingClient: ITradingClient;
  alertRules: AlertRulesService;
  notifications: NotificationsService;
  priceCache: PriceCache;
  approvalManager: ApprovalManager;
  sessionManager: SessionManager;
  eventBus: EventBus;
  channelManager: ChannelManager;
  pairingStore: PairingStore;
  runner: Runner;
  contextBuilder: ContextBuilder;
  logger: Logger;
  /** Lazy bus accessor so tests can stub. Production passes runtime.bus. */
  getMessageBus: () => Runtime["bus"];
}

export class ObserverLoop {
  private readonly store: ObserverStateStore;
  private cachedRest: SnapshotInput | null = null;
  // Seeded to construction time, NOT null. Treats "daemon just started" as
  // "we just spoke" so the judge stays quiet on routine status (pnl_snapshot,
  // routine order_filled) for the first hour after every boot. Without this,
  // the first tick post-restart fires "ETH short running nicely +$X" the
  // moment the user opens the web app — which is exactly the spam complaint
  // this loop is supposed to prevent.
  private lastProactiveAtMs: number;

  constructor(private readonly deps: ObserverLoopDeps) {
    this.store = new ObserverStateStore(deps.db);
    this.lastProactiveAtMs = Date.now();
  }

  /**
   * One observer pass. Catches all errors internally — never throws back
   * to the BackgroundJobRunner so a transient HL outage doesn't disable
   * the loop. Emits exactly one info-level log line per tick.
   */
  async tick(): Promise<void> {
    const nowMs = Date.now();

    // -----------------------------------------------------------------
    // 0. Wallet gate. Account-data endpoints (`clearinghouseState`,
    //    `openOrders`, fills, historical orders) all require a valid HL
    //    address. With no wallet connected the trading client's
    //    `defaultAddress` is the empty string and HL responds 422 on every
    //    sync — which previously surfaced as a noisy WARN every tickMs.
    //    Quietly no-op until a wallet is connected.
    // -----------------------------------------------------------------
    if (!this.deps.tradingClient.address) {
      this.deps.logger.debug("observer tick — no wallet connected, skipping");
      return;
    }

    const prior = this.store.load();

    // -----------------------------------------------------------------
    // 1. Confirm-card gate.
    // -----------------------------------------------------------------
    const pending = this.deps.approvalManager.getPending(MAIN_SESSION_KEY);
    if (pending) {
      await this.refreshBaselineQuietly(prior, nowMs);
      this.deps.logger.info("observer tick — gated (confirm card open)");
      return;
    }

    // -----------------------------------------------------------------
    // 2. Age-aware REST sync.
    // -----------------------------------------------------------------
    let rest: SnapshotInput;
    let synced = false;
    const syncDue =
      this.cachedRest === null ||
      nowMs - prior.lastRestSyncAtMs >= this.deps.config.syncIntervalMs;
    try {
      if (syncDue) {
        rest = await fetchSnapshot(this.deps.tradingClient, prior.lastFillTimestamp);
        this.cachedRest = rest;
        synced = true;
      } else {
        rest = this.cachedRest!;
      }
    } catch (err) {
      this.deps.logger.warn({ err }, "observer tick — REST sync failed");
      return;
    }

    // -----------------------------------------------------------------
    // 3. Detect — pure predicates over (rest + alertRules + priceCache).
    // -----------------------------------------------------------------
    const currentOpenOrderIds = rest.openOrders.map((o) => o.orderId);
    const prices = this.deps.priceCache.snapshot();
    const alertRules = this.deps.alertRules.list();

    const diff = diffSnapshot({
      prior,
      positions: rest.positions,
      openOrders: rest.openOrders,
      newFills: rest.newFills,
      newHistoricalOrders: rest.newHistoricalOrders,
      alertRules,
      prices,
      liqProgressThreshold: this.deps.config.liquidationProgressThreshold,
      nowMs,
    });

    // -----------------------------------------------------------------
    // 4. Mark fired alert rules. Idempotent — `markFired` no-ops when
    //    already fired, so re-running across ticks before sync advances
    //    won't re-emit.
    // -----------------------------------------------------------------
    for (const id of diff.firedAlertIds) {
      this.deps.alertRules.markFired(id, Math.floor(nowMs / 1000));
    }

    // -----------------------------------------------------------------
    // 4b. Per-position pnl_snapshot rate-limit. Drop snapshots
    //     where Δpnl%, Δprice%, AND elapsed-ms are all under threshold vs
    //     the prior fired pnl message on the same position. Detector keeps
    //     emitting every tick; the gate sits between diff and judge.
    // -----------------------------------------------------------------
    const gatedEvents = filterPnlSnapshots(diff.events, prior.positions, nowMs);

    // -----------------------------------------------------------------
    // 5. Next baseline. Persist AFTER eval succeeds so a crash mid-tick
    //    re-evaluates the same input next tick (idempotent).
    // -----------------------------------------------------------------
    const nextSnapshot: ObserverSnapshot = {
      positions: diff.nextPositions,
      lastFillTimestamp: rest.latestFillTimestamp,
      openOrderIds: currentOpenOrderIds,
      lastRestSyncAtMs: synced ? nowMs : prior.lastRestSyncAtMs,
      recentCancelOids: mergeCancelOids(prior.recentCancelOids, diff.emittedCancelOids),
      recentEmittedFillIds: mergeBoundedIds(
        prior.recentEmittedFillIds,
        diff.emittedFillIds,
        RECENT_FILL_IDS_CAP,
      ),
    };
    const scanCounts = {
      positions: rest.positions.length,
      orders: rest.openOrders.length,
      fills: rest.newFills.length,
      history: rest.newHistoricalOrders.length,
      alertRules: alertRules.length,
      firedAlerts: diff.firedAlertIds.length,
      synced,
    };

    // -----------------------------------------------------------------
    // 6. Filter — skip LLM when nothing structural happened. Operates on
    //    the pnl-gated event list so a tick whose only events were
    //    rate-limited pnl_snapshots also short-circuits.
    // -----------------------------------------------------------------
    if (!filterPassesLlm(gatedEvents, prior, currentOpenOrderIds)) {
      this.store.save(nextSnapshot);
      this.deps.eventBus.publish({
        type: "observer.tick",
        payload: { eventCount: gatedEvents.length, decision: "skip", ts: nowMs },
      });
      this.deps.logger.info(
        { ...scanCounts, events: gatedEvents.length, decision: "skip" },
        "observer tick — no structural change, judge skipped",
      );
      return;
    }

    // -----------------------------------------------------------------
    // 7. Judge skill — single LLM call. Decides body + notify flag.
    // -----------------------------------------------------------------
    const recentChat = this.snapshotRecentChat();
    let judge: JudgeResponse;
    try {
      judge = await callJudge({
        runner: this.deps.runner,
        contextBuilder: this.deps.contextBuilder,
        events: gatedEvents,
        recentChat,
        lastProactiveAtMs: this.lastProactiveAtMs,
        nowMs,
      });
    } catch (err) {
      this.deps.logger.warn({ err }, "observer: judge call failed — treating as silent");
      judge = {
        decision: "silent",
        primaryEventType: null,
        primarySymbol: null,
        body: null,
        notify: false,
        reason: "judge_threw",
      };
    }

    this.deps.eventBus.publish({
      type: "observer.tick",
      payload: {
        eventCount: gatedEvents.length,
        decision: judge.decision,
        primaryEventType: judge.primaryEventType,
        primarySymbol: judge.primarySymbol,
        reason: judge.reason,
        ts: nowMs,
      },
    });

    // -----------------------------------------------------------------
    // 8. Dispatch on fire.
    // -----------------------------------------------------------------
    if (judge.decision === "fire" && judge.body) {
      await this.dispatch(judge, nowMs);
      this.lastProactiveAtMs = nowMs;
      // stamp the `lastFired*` quad onto the next-snapshot
      // entry for the affected position so the per-position pnl-snapshot
      // gate has durable memory across ticks. Only on `pnl_snapshot`
      // fires — other event types do not throttle.
      stampLastFiredPnl(nextSnapshot, judge, gatedEvents, nowMs);
    }

    this.deps.logger.info(
      {
        ...scanCounts,
        events: gatedEvents.length,
        eventTypes: countEventsByType(gatedEvents),
        decision: judge.decision,
        primaryEventType: judge.primaryEventType,
        primarySymbol: judge.primarySymbol,
        notify: judge.notify,
        reason: judge.reason,
      },
      `observer tick — judge ${judge.decision}`,
    );

    // -----------------------------------------------------------------
    // 9. Persist baseline.
    // -----------------------------------------------------------------
    this.store.save(nextSnapshot);
  }

  /**
   * Refresh the persisted baseline while a confirm card blocks the tick.
   * REST sync still respects the age gate; no events are emitted, no LLM
   * call is made, no fired rules are marked. The next post-confirm tick
   * diffs against fresh state.
   */
  private async refreshBaselineQuietly(prior: ObserverSnapshot, nowMs: number): Promise<void> {
    try {
      let rest: SnapshotInput;
      const syncDue =
        this.cachedRest === null ||
        nowMs - prior.lastRestSyncAtMs >= this.deps.config.syncIntervalMs;
      if (syncDue) {
        rest = await fetchSnapshot(this.deps.tradingClient, prior.lastFillTimestamp);
        this.cachedRest = rest;
      } else {
        rest = this.cachedRest!;
      }
      const diff = diffSnapshot({
        prior,
        positions: rest.positions,
        openOrders: rest.openOrders,
        newFills: rest.newFills,
        newHistoricalOrders: rest.newHistoricalOrders,
        alertRules: this.deps.alertRules.list(),
        prices: this.deps.priceCache.snapshot(),
        liqProgressThreshold: this.deps.config.liquidationProgressThreshold,
        nowMs,
      });
      this.store.save({
        positions: diff.nextPositions,
        lastFillTimestamp: rest.latestFillTimestamp,
        openOrderIds: rest.openOrders.map((o) => o.orderId),
        lastRestSyncAtMs: syncDue ? nowMs : prior.lastRestSyncAtMs,
        recentCancelOids: mergeCancelOids(prior.recentCancelOids, diff.emittedCancelOids),
        recentEmittedFillIds: mergeBoundedIds(
          prior.recentEmittedFillIds,
          diff.emittedFillIds,
          RECENT_FILL_IDS_CAP,
        ),
      });
    } catch (err) {
      this.deps.logger.warn({ err }, "observer: baseline refresh failed under confirm gate");
    }
  }

  /**
   * Single dispatch path. Chat broadcast goes to web + every paired
   * Telegram identity. When `notify=true`, also stamps a row into
   * NotificationsService (powers bell-dropdown).
   */
  private async dispatch(judge: JudgeResponse, nowMs: number): Promise<void> {
    if (!judge.body) return;

    const messageId = `observer:${nowMs}:${crypto.randomUUID()}`;

    const channels = this.buildOutboundChannels();

    // Chat broadcast — every fire produces a chat turn.
    await dispatchOutbound(channels, judge.body, {
      eventBus: this.deps.eventBus,
      bus: this.deps.getMessageBus(),
      source: judge.notify ? `observer:notify` : `observer:chat`,
      id: messageId,
      logger: this.deps.logger,
    });

    // Persist into the main session so `chat.history` returns the
    // message after F5. Web's HistoryMessage reads only role/content/
    // timestamp/id — pi-ai's api/provider/model/usage fields are elided
    // via the cast (synthetic turns never round-trip through pi-ai
    // consumers).
    try {
      const session = this.deps.sessionManager.getOrCreate(MAIN_SESSION_KEY);
      session.addMessage({
        role: "assistant",
        content: [{ type: "text", text: judge.body }],
        timestamp: nowMs,
        id: messageId,
      } as unknown as Message);
    } catch (err) {
      this.deps.logger.warn(
        { err, messageId },
        "observer: failed to persist proactive message to session log",
      );
    }

    if (!judge.notify) return;

    // Notification badge — typed kind, no schema-abuse sentinels.
    const kind = mapKindFromEventType(judge.primaryEventType);
    const symbol = judge.primarySymbol ?? undefined;
    try {
      this.deps.notifications.insert(kind, judge.body, {
        id: messageId,
        symbol,
        payload: { primaryEventType: judge.primaryEventType },
        tsUnix: Math.floor(nowMs / 1000),
      });
    } catch (err) {
      this.deps.logger.warn({ err, id: messageId }, "observer: notification insert failed");
    }
  }

  /**
   * Expand outbound channels to web + every allowlisted Telegram identity.
   * Differs from the generic `getOutboundChannels` (which returns only the
   * primary chat) so multi-paired users receive every observer message.
   */
  private buildOutboundChannels(): OutboundChannel[] {
    const out: OutboundChannel[] = [{ kind: "web" }];
    if (this.deps.channelManager.isActive(ChannelId.Telegram)) {
      const ids = this.deps.pairingStore.listAllowlistIdentities(ChannelId.Telegram);
      for (const chatId of ids) {
        if (!/^\d+$/.test(chatId)) continue;
        out.push({ kind: ChannelId.Telegram, chatId });
      }
    }
    return out;
  }

  /**
   * Last N text-bearing messages from the main session, oldest first.
   * Tool calls / synthetic markers are stripped so the judge prompt sees
   * only conversational substance.
   */
  private snapshotRecentChat(): ChatSnippet[] {
    const session = this.deps.sessionManager.getOrCreate(MAIN_SESSION_KEY);
    const out: ChatSnippet[] = [];
    for (const msg of session.messages) {
      const m = msg as { role?: string; content?: unknown; timestamp?: number };
      if (m.role !== "user" && m.role !== "assistant") continue;
      if (!Array.isArray(m.content)) continue;
      let text = "";
      for (const block of m.content as Array<{ type?: string; text?: unknown }>) {
        if (block?.type === "text" && typeof block.text === "string") {
          text += block.text;
        }
      }
      if (text.trim().length === 0) continue;
      out.push({
        role: m.role,
        text: text.trim(),
        timestamp: typeof m.timestamp === "number" ? m.timestamp : Date.now(),
      });
    }
    return out.slice(-RECENT_CHAT_MAX);
  }
}

/**
 * Append freshly-emitted ids to a rolling dedup window. Dedup is preserved
 * (Set-based) and the result is truncated to `cap`, keeping the MOST RECENT
 * entries (newest at the tail). Pure helper for testability — shared by both
 * `recentCancelOids` and `recentEmittedFillIds`.
 */
export function mergeBoundedIds(
  prior: ReadonlyArray<string>,
  fresh: ReadonlyArray<string>,
  cap: number,
): string[] {
  if (fresh.length === 0) {
    return prior.length <= cap ? [...prior] : prior.slice(prior.length - cap);
  }
  const seen = new Set<string>(prior);
  const merged = [...prior];
  for (const id of fresh) {
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(id);
  }
  if (merged.length <= cap) return merged;
  return merged.slice(merged.length - cap);
}

/** Cancel-oid specific wrapper preserved so existing call sites and tests
 *  read naturally. */
function mergeCancelOids(prior: ReadonlyArray<string>, fresh: ReadonlyArray<string>): string[] {
  return mergeBoundedIds(prior, fresh, RECENT_CANCEL_OIDS_CAP);
}

/**
 * Stamp the last-fired pnl_snapshot quad onto the next-snapshot position
 * row after a successful judge fire. No-op for non-pnl fires.
 * Picks the matching event by `(symbol, side)` from `gatedEvents` (the
 * judge only ever sees gated events) and uses its current PnL / mark as
 * the fire-time anchor.
 *
 * Mutates `nextSnapshot.positions[key]` in place — the snapshot is owned
 * by the caller and persisted immediately after this call.
 */
function stampLastFiredPnl(
  nextSnapshot: ObserverSnapshot,
  judge: JudgeResponse,
  gatedEvents: ObserverEvent[],
  nowMs: number,
): void {
  if (
    judge.primaryEventType !== "pnl_snapshot" ||
    judge.primarySymbol === null
  ) {
    return;
  }
  const wantedSymbol = judge.primarySymbol.toUpperCase();
  const ev = gatedEvents.find(
    (e) => e.type === "pnl_snapshot" && e.symbol.toUpperCase() === wantedSymbol,
  );
  if (!ev || ev.type !== "pnl_snapshot") return;
  const key = `${ev.symbol.toUpperCase()}|${ev.side}`;
  const entry = nextSnapshot.positions[key];
  if (!entry) return;
  entry.lastFiredPnl = ev.unrealizedPnl;
  entry.lastFiredPnlPct = ev.unrealizedPnlPct;
  entry.lastFiredMarkPrice = ev.markPrice;
  entry.lastFiredAtMs = nowMs;
}

/** Compact event-type histogram for the per-tick info log. */
function countEventsByType(events: ObserverEvent[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const ev of events) out[ev.type] = (out[ev.type] ?? 0) + 1;
  return out;
}

/**
 * Map the judge's `primaryEventType` to the notification kind used for the
 * bell-dropdown row. Returns a typed `NotificationKind` so callers don't
 * need an escape hatch.
 */
function mapKindFromEventType(t: string | null): NotificationKind {
  switch (t) {
    case "position_liquidated":
    case "liquidation_risk":
      return "liquidation_risk";
    case "tp_hit":
      return "tp_hit";
    case "sl_hit":
      return "sl_hit";
    case "position_closed":
      return "position_closed";
    case "price_alert":
      return "price_target";
    case "order_canceled":
      return "order_canceled";
    case "order_filled":
      return "order_filled";
    default:
      return "proactive";
  }
}
