import { useEffect, useRef, type Dispatch, type SetStateAction, type MutableRefObject } from 'react';
import type { EventFrame } from '@/lib/gateway';
import type { ChatMessage, ToolCallEntry } from '@/lib/chatTypes';
import { cleanDisplayText } from '@/lib/chatTypes';
import { inlineErrorText, isKnownErrorType, type GhostErrorType } from '@/lib/inline-error-text';
import type { ConfirmationData } from '@/lib/confirmation-types';
import type { ThinkingPhase } from '@/components/chat/thinking-utils';

interface ChatEventDeps {
  subscribe: (cb: (evt: EventFrame) => void) => () => void;
  chatRunIdRef: MutableRefObject<string | null>;
  streamRef: MutableRefObject<string[]>;
  toolCallsRef: MutableRefObject<Map<string, ToolCallEntry>>;
  suppressResponseRef: MutableRefObject<boolean>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setChatRunId: Dispatch<SetStateAction<string | null>>;
  setChatSending: Dispatch<SetStateAction<boolean>>;
  setActiveToolCalls: Dispatch<SetStateAction<ToolCallEntry[]>>;
  setThinkingPhase: Dispatch<SetStateAction<ThinkingPhase | null>>;
  setThinkingDetail: Dispatch<SetStateAction<string | null>>;
  loadSessions: () => void;
  flushQueue: () => void;
  /** When false, tool call/result events are suppressed (no chips rendered). */
  showToolCalls: boolean;
}

function resetRunState(deps: Pick<ChatEventDeps, 'streamRef' | 'chatRunIdRef' | 'toolCallsRef' | 'setChatRunId' | 'setChatSending' | 'setActiveToolCalls' | 'setThinkingPhase' | 'setThinkingDetail'>) {
  deps.streamRef.current = [];
  deps.toolCallsRef.current = new Map();
  deps.setChatRunId(null);
  deps.chatRunIdRef.current = null;
  deps.setChatSending(false);
  deps.setActiveToolCalls([]);
  deps.setThinkingPhase(null);
  deps.setThinkingDetail(null);
}

interface StreamingRefs {
  streamingRafRef: MutableRefObject<number | null>;
  streamingMsgIdRef: MutableRefObject<string | null>;
  streamingTextRef: MutableRefObject<string>;
}

function cleanupStreamingRefs(refs: StreamingRefs) {
  if (refs.streamingRafRef.current) {
    cancelAnimationFrame(refs.streamingRafRef.current);
    refs.streamingRafRef.current = null;
  }
  refs.streamingMsgIdRef.current = null;
  refs.streamingTextRef.current = '';
}

export function useChatEvents(deps: ChatEventDeps) {
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const flushedTextRef = useRef('');
  const allTextRef = useRef(''); // all accumulated text across turns (for dedup)
  const executingApprovalRef = useRef<string | null>(null);
  const streamingMsgIdRef = useRef<string | null>(null);
  const streamingTextRef = useRef('');
  const streamingRafRef = useRef<number | null>(null);
  const streamingRefs: StreamingRefs = { streamingRafRef, streamingMsgIdRef, streamingTextRef };

  /** Remove the streaming flag from a message and update its content. */
  function finalizeMsg(m: ChatMessage, content: string, toolCalls?: ToolCallEntry[]): ChatMessage {
    const { streaming: _, ...rest } = m;
    return { ...rest, content, ...(toolCalls ? { toolCalls } : {}) };
  }

  useEffect(() => {
    const unsub = deps.subscribe((evt: EventFrame) => {
      const d = depsRef.current;
      const payload = evt.payload as Record<string, unknown> | undefined;
      const runId = payload?.runId as string | undefined;

      if (runId && d.chatRunIdRef.current && runId !== d.chatRunIdRef.current) return;

      switch (evt.event) {
        case 'chat.delta': {
          const delta = String(payload?.delta ?? '');
          d.streamRef.current.push(delta);
          allTextRef.current += delta; // all text across turns (for dedup with flushedTextRef)
          streamingTextRef.current += delta; // current turn only (reset on turn/done)

          if (!streamingMsgIdRef.current) {
            // Clear the thinking indicator once content starts streaming —
            // the message itself is the visual cue now, so showing a
            // "Composing" label next to it is redundant.
            d.setThinkingPhase(null);
            d.setThinkingDetail(null);
            streamingMsgIdRef.current = crypto.randomUUID();
            d.setMessages((prev) => [
              ...prev,
              { id: streamingMsgIdRef.current!, role: 'assistant', content: '', timestamp: new Date(), streaming: true },
            ]);
          }

          if (!streamingRafRef.current) {
            streamingRafRef.current = requestAnimationFrame(() => {
              streamingRafRef.current = null;
              const sid = streamingMsgIdRef.current;
              if (sid) {
                const text = streamingTextRef.current;
                d.setMessages((prev) =>
                  prev.map((m) => m.id === sid ? { ...m, content: text } : m),
                );
              }
            });
          }
          break;
        }

        case 'chat.turn': {
          const sid = streamingMsgIdRef.current;
          const text = streamingTextRef.current;
          cleanupStreamingRefs(streamingRefs);
          if (sid) {
            const cleaned = cleanDisplayText(text);
            if (!cleaned) {
              d.setMessages((prev) => prev.filter((m) => m.id !== sid));
            } else {
              d.setMessages((prev) =>
                prev.map((m) => m.id === sid ? finalizeMsg(m, cleaned) : m),
              );
            }
          }
          flushedTextRef.current = allTextRef.current;   // mark all text so far as shown
          d.streamRef.current = [];
          break;
        }

        case 'chat.tool_call': {
          const toolName = String(payload?.name ?? '');
          // Strip mcp__ghost__ prefix (CLI provider) or ghost_ prefix for display
          const displayName = toolName.replace(/^mcp__ghost__/, '').replace(/^ghost_/, '');
          d.setThinkingPhase('fetching');
          d.setThinkingDetail(displayName);

          if (!d.showToolCalls) break;
          const entry: ToolCallEntry = {
            toolCallId: String(payload?.toolCallId ?? ''),
            name: toolName,
            argsHint: String(payload?.argsHint ?? ''),
            argsFull: payload?.argsFull as string | undefined,
            status: 'running',
          };
          d.toolCallsRef.current.set(entry.toolCallId, entry);
          d.setActiveToolCalls([...d.toolCallsRef.current.values()]);
          break;
        }

        case 'chat.tool_result': {
          // Transition to analyzing after tool results come back
          d.setThinkingPhase('analyzing');
          d.setThinkingDetail(null);

          // Always process approval-related results regardless of showToolCalls
          const id = String(payload?.toolCallId ?? '');
          const success = payload?.success as boolean | undefined;

          // Update confirmation card with execution outcome
          const aid = executingApprovalRef.current;
          if (aid) {
            const outcome = success === false ? 'failed' : 'executed';
            executingApprovalRef.current = null;
            d.setMessages((prev) =>
              prev.map((m) => m.id === aid ? { ...m, status: outcome } : m),
            );
          }

          if (!d.showToolCalls) break;
          const existing = d.toolCallsRef.current.get(id);
          if (existing) {
            const updated: ToolCallEntry = {
              ...existing,
              success,
              durationSecs: payload?.durationSecs as number | undefined,
              result: payload?.result as string | undefined,
              status: 'done',
            };
            d.toolCallsRef.current.set(id, updated);
            d.setActiveToolCalls([...d.toolCallsRef.current.values()]);
          }
          break;
        }

        case 'chat.done': {
          if (d.suppressResponseRef.current) {
            d.suppressResponseRef.current = false;
            const sid = streamingMsgIdRef.current;
            cleanupStreamingRefs(streamingRefs);
            if (sid) {
              d.setMessages((prev) => prev.filter((m) => m.id !== sid));
            }
            flushedTextRef.current = '';
            allTextRef.current = '';
            resetRunState(d);
            break;
          }

          const sid = streamingMsgIdRef.current;
          cleanupStreamingRefs(streamingRefs);

          let response = cleanDisplayText(String(
            payload?.response ?? d.streamRef.current.join(''),
          ));
          const flushed = cleanDisplayText(flushedTextRef.current);
          if (flushed && response.startsWith(flushed)) {
            response = response.slice(flushed.length).trim();
          }
          flushedTextRef.current = '';
          allTextRef.current = '';

          const toolCalls = d.showToolCalls && d.toolCallsRef.current.size > 0
            ? [...d.toolCallsRef.current.values()]
            : undefined;

          if (sid && response) {
            d.setMessages((prev) =>
              prev.map((m) => m.id === sid ? finalizeMsg(m, response, toolCalls) : m),
            );
          } else if (sid && !response) {
            d.setMessages((prev) => prev.filter((m) => m.id !== sid));
          } else if (response) {
            d.setMessages((prev) => [
              ...prev,
              { id: crypto.randomUUID(), role: 'assistant', content: response, timestamp: new Date(), toolCalls },
            ]);
          }

          resetRunState(d);
          d.loadSessions();
          setTimeout(d.flushQueue, 0);
          break;
        }

        case 'chat.error': {
          const sid = streamingMsgIdRef.current;
          cleanupStreamingRefs(streamingRefs);
          if (sid) {
            d.setMessages((prev) => prev.filter((m) => m.id !== sid));
          }
          flushedTextRef.current = '';
          allTextRef.current = '';

          // Every chat error renders as an inline assistant bubble so the
          // failed turn reads like a reply — the banner is reserved for the
          // websocket-disconnect state only. The
          // friendly copy is resolved at the edge here, so MessageBubble
          // can stay dumb and just display `content`.
          //
          // Drift detection: if the backend ships a new errorType code
          // (e.g. `BILLING_REQUIRED`) before the frontend has been updated,
          // we'd silently fall through to UNKNOWN. `isKnownErrorType`
          // narrows safely and warns so the gap surfaces in dev.
          const rawErrorType: unknown = payload?.errorType;
          let errorType: GhostErrorType | undefined;
          if (rawErrorType === undefined || rawErrorType === null) {
            errorType = undefined;
          } else if (isKnownErrorType(rawErrorType)) {
            errorType = rawErrorType;
          } else {
            console.warn(
              '[useChatEvents] unknown errorType from backend, falling back to UNKNOWN copy:',
              rawErrorType,
            );
            errorType = 'UNKNOWN';
          }
          d.setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: 'assistant',
              content: inlineErrorText(errorType),
              timestamp: new Date(),
              type: 'error',
            },
          ]);
          resetRunState(d);
          break;
        }

        case 'chat.proactive': {
          // Already-finished message — no streaming or run state.
          const content = String(payload?.content ?? '');
          const id = String(payload?.id ?? `proactive-${crypto.randomUUID()}`);
          if (!content) break;
          d.setMessages((prev) => {
            // Idempotency guard against double-publish.
            if (prev.some((m) => m.id === id)) return prev;
            return [
              ...prev,
              { id, role: 'assistant', content, timestamp: new Date() },
            ];
          });
          break;
        }

        case 'chat.aborted': {
          const sid = streamingMsgIdRef.current;
          cleanupStreamingRefs(streamingRefs);
          if (sid) {
            d.setMessages((prev) => prev.filter((m) => m.id !== sid));
          }
          flushedTextRef.current = '';
          allTextRef.current = '';
          resetRunState(d);
          break;
        }

        case 'trading.approval.requested': {
          const preview = payload?.preview as ConfirmationData | undefined;
          const approvalId = payload?.approvalId as string | undefined;
          if (preview && approvalId) {
            // Use preText (current turn's text from orchestrator) when
            // chat.delta frames haven't arrived yet due to WebSocket batching.
            const sid = streamingMsgIdRef.current;
            cleanupStreamingRefs(streamingRefs);

            const buffered = d.streamRef.current.join('');
            const preText = (payload?.preText as string | undefined) ?? '';
            const rawText = preText.length > buffered.length ? preText : buffered;
            const streamedText = cleanDisplayText(rawText);
            flushedTextRef.current = allTextRef.current;
            d.streamRef.current = [];

            if (sid && streamedText) {
              d.setMessages((prev) =>
                prev.map((m) => m.id === sid ? finalizeMsg(m, streamedText) : m),
              );
            }

            d.setMessages((prev) => {
              const next = [...prev];
              if (streamedText && !sid) {
                next.push({
                  id: crypto.randomUUID(),
                  role: 'assistant',
                  content: streamedText,
                  timestamp: new Date(),
                });
              }
              next.push({
                id: approvalId,
                role: 'assistant',
                content: preview.summary ?? '',
                timestamp: new Date(),
                type: 'confirmation',
                data: { ...preview, approvalId },
                status: 'pending',
              });
              return next;
            });
          }
          break;
        }

        case 'trading.approval.resolved': {
          const resolvedId = payload?.approvalId as string | undefined;
          const decision = payload?.decision as string | undefined;
          if (resolvedId && decision === 'approved') {
            executingApprovalRef.current = resolvedId;
            d.setMessages((prev) =>
              prev.map((m) =>
                m.id === resolvedId ? { ...m, status: 'executing' } : m,
              ),
            );
          } else if (resolvedId && decision === 'rejected') {
            d.setMessages((prev) =>
              prev.map((m) =>
                m.id === resolvedId ? { ...m, status: 'rejected' } : m,
              ),
            );
          } else if (resolvedId && decision === 'expired') {
            // Expired: the card shows the outcome on its own. Suppress any
            // follow-up agent text ("Cancelled...") so the user sees a clean
            // state transition without a redundant chat bubble.
            d.suppressResponseRef.current = true;
            d.setMessages((prev) =>
              prev.map((m) =>
                m.id === resolvedId ? { ...m, status: 'expired' } : m,
              ),
            );
          }
          break;
        }

        case 'mcp.tool_result': {
          // CLI path: MCP tool finished execution. Update confirmation card
          // that may be stuck in "executing" (chat.tool_result fires too early
          // in the CLI path — before the MCP tool actually runs).
          const aid = executingApprovalRef.current;
          if (aid) {
            const success = payload?.success as boolean | undefined;
            const outcome = success === false ? 'failed' : 'executed';
            executingApprovalRef.current = null;
            d.setMessages((prev) =>
              prev.map((m) => m.id === aid ? { ...m, status: outcome } : m),
            );
          }
          break;
        }

        case 'wallet.changed': {
          window.dispatchEvent(new Event("ghost-wallet-changed"));
          break;
        }

        case 'tool.approval.requested': {
          const preview = payload?.preview as ConfirmationData | undefined;
          const approvalId = payload?.approvalId as string | undefined;
          if (preview && approvalId) {
            const sid = streamingMsgIdRef.current;
            cleanupStreamingRefs(streamingRefs);

            const buffered = d.streamRef.current.join('');
            const streamedText = cleanDisplayText(buffered);
            flushedTextRef.current = allTextRef.current;
            d.streamRef.current = [];

            if (sid && streamedText) {
              d.setMessages((prev) =>
                prev.map((m) => m.id === sid ? finalizeMsg(m, streamedText) : m),
              );
            }

            d.setMessages((prev) => {
              const next = [...prev];
              if (streamedText && !sid) {
                next.push({
                  id: crypto.randomUUID(),
                  role: 'assistant',
                  content: streamedText,
                  timestamp: new Date(),
                });
              }
              next.push({
                id: approvalId,
                role: 'assistant',
                content: preview.summary ?? '',
                timestamp: new Date(),
                type: 'confirmation',
                data: { ...preview, approvalId },
                status: 'pending',
              });
              return next;
            });
          }
          break;
        }

        case 'tool.approval.resolved': {
          const resolvedId = payload?.approvalId as string | undefined;
          const decision = payload?.decision as string | undefined;
          if (resolvedId && decision === 'approved') {
            d.setMessages((prev) =>
              prev.map((m) =>
                m.id === resolvedId ? { ...m, status: 'approved' } : m,
              ),
            );
          } else if (resolvedId) {
            d.setMessages((prev) =>
              prev.map((m) =>
                m.id === resolvedId ? { ...m, status: 'rejected' } : m,
              ),
            );
          }
          break;
        }
      }
    });
    return () => {
      unsub();
      cleanupStreamingRefs(streamingRefs);
    };
    // Intentional: resubscribe only when the gateway's subscribe identity
    // changes. `deps` is read via `depsRef.current` (fresh every render) and
    // `streamingRefs` wraps `useRef` objects whose identities are stable —
    // listing either would cause a resubscribe on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps.subscribe]);
}
