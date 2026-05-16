/**
 * `snapshotEntities` transformer — protects sendMessage payloads from
 * caller-side mutation of the `entities` array between an initial call and
 * any @grammyjs/auto-retry replay that re-uses the same payload object.
 */

import { describe, test, expect } from "bun:test";
import type { MessageEntity } from "grammy/types";
import { snapshotEntities } from "../../src/channels/telegram/helpers.js";

type Captured = { method: string; payload: Record<string, unknown> & { entities?: unknown } };

function makePrev(captured: Captured[]) {
  return async (method: string, payload: Record<string, unknown>): Promise<{ ok: true; result: unknown }> => {
    captured.push({ method, payload });
    return { ok: true, result: { message_id: captured.length } };
  };
}

describe("snapshotEntities — payload immutability under caller mutation", () => {
  test("sendMessage: caller mutation after call does not leak into prev", async () => {
    const t = snapshotEntities();
    const captured: Captured[] = [];
    const liveEntities: MessageEntity[] = [{ type: "bold", offset: 0, length: 5 }];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await t(makePrev(captured) as any, "sendMessage", { chat_id: 1, text: "hello", entities: liveEntities } as any, undefined);

    // Mutate the original array AFTER the transformer ran — mimicking a
    // caller mutating entities between the initial call and an auto-retry replay.
    liveEntities.push({ type: "italic", offset: 5, length: 5 });

    const observed = captured[0]!.payload.entities as MessageEntity[];
    expect(observed).toHaveLength(1);
    expect(observed).not.toBe(liveEntities);
  });

  test("non-target method: payload passed through by reference", async () => {
    const t = snapshotEntities();
    const captured: Captured[] = [];
    const payload = { chat_id: 1, photo: "p.jpg", entities: [{ type: "bold", offset: 0, length: 1 }] };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await t(makePrev(captured) as any, "sendPhoto" as any, payload as any, undefined);

    expect(captured[0]!.payload).toBe(payload);
  });

  test("missing entities: payload passed through by reference", async () => {
    const t = snapshotEntities();
    const captured: Captured[] = [];
    const payload = { chat_id: 1, text: "hello" };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await t(makePrev(captured) as any, "sendMessage" as any, payload as any, undefined);

    expect(captured[0]!.payload).toBe(payload);
  });

  test("forwards AbortSignal to prev", async () => {
    const t = snapshotEntities();
    let observedSignal: AbortSignal | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prev = (async (_m: string, _p: unknown, s: AbortSignal | undefined) => {
      observedSignal = s;
      return { ok: true, result: {} };
    }) as any;
    const signal = new AbortController().signal;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await t(prev, "sendMessage" as any, { chat_id: 1, text: "x", entities: [] } as any, signal);

    expect(observedSignal).toBe(signal);
  });
});
