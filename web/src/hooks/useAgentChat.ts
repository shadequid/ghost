import { useState, useEffect, useRef, useCallback } from 'react';
import { useGateway } from '@/hooks/useGateway';
import { historyToMessages } from '@/lib/chatTypes';
import type { ChatMessage, QueuedMessage, SessionEntry, HistoryMessage, ToolCallEntry } from '@/lib/chatTypes';
import { useChatEvents } from './useChatEvents';
import type { ThinkingPhase } from '@/components/chat/thinking-utils';

export type { ChatMessage, QueuedMessage, SessionEntry, ToolCallEntry } from '@/lib/chatTypes';
export type { ThinkingPhase } from '@/components/chat/thinking-utils';

const STOP_COMMANDS = new Set(['/stop', 'stop', 'abort', 'esc']);

export function useAgentChat() {
  const { request, connected, subscribe, client } = useGateway();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatRunId, setChatRunId] = useState<string | null>(null);
  const [chatSending, setChatSending] = useState(false);

  const [sessionKey, setSessionKey] = useState('default');
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [sessionDropdownOpen, setSessionDropdownOpen] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(false);

  const [queue, setQueue] = useState<QueuedMessage[]>([]);
  const [activeToolCalls, setActiveToolCalls] = useState<ToolCallEntry[]>([]);
  const [showToolCalls, setShowToolCalls] = useState(false);
  const [paperMode, setPaperMode] = useState(false);
  const wasConnected = useRef(false);
  if (connected) wasConnected.current = true;
  const disconnected = !connected && wasConnected.current;
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const [hasNewContent, setHasNewContent] = useState(false);
  const [thinkingPhase, setThinkingPhase] = useState<ThinkingPhase | null>(null);
  const [thinkingDetail, setThinkingDetail] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const chatRunIdRef = useRef<string | null>(null);
  const sessionKeyRef = useRef(sessionKey);
  const queueRef = useRef<QueuedMessage[]>([]);
  const streamRef = useRef<string[]>([]);
  const toolCallsRef = useRef<Map<string, ToolCallEntry>>(new Map());
  const suppressResponseRef = useRef(false);

  chatRunIdRef.current = chatRunId;
  sessionKeyRef.current = sessionKey;
  queueRef.current = queue;

  // -- Scroll --
  // During streaming, new tokens arrive many times per second. Calling
  // scrollIntoView({behavior:'smooth'}) on every update makes the browser
  // cancel the in-flight smooth scroll and start a new one, producing a
  // visible stutter. Batch with rAF and use instant scroll during streaming;
  // only the user-triggered "jump to bottom" button uses smooth.
  const scrollRafRef = useRef<number | null>(null);

  const checkIfScrolledUp = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    setUserScrolledUp(!isAtBottom);
    if (isAtBottom) setHasNewContent(false);
  }, []);

  const scheduleScrollToEnd = useCallback((smooth: boolean) => {
    if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
    });
  }, []);

  const scrollToBottom = useCallback(() => {
    scheduleScrollToEnd(true);
    setUserScrolledUp(false);
    setHasNewContent(false);
  }, [scheduleScrollToEnd]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.addEventListener('scroll', checkIfScrolledUp);
    return () => el.removeEventListener('scroll', checkIfScrolledUp);
  }, [checkIfScrolledUp]);

  useEffect(() => () => {
    if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
  }, []);

  const lastMsgLenRef = useRef(messages.length);
  useEffect(() => {
    const prevLen = lastMsgLenRef.current;
    lastMsgLenRef.current = messages.length;
    if (!userScrolledUp) {
      scheduleScrollToEnd(false);
      return;
    }
    // Only flag "new message" when the list actually grew. Scrolling up
    // alone (length unchanged) must leave hasNewContent at false.
    if (messages.length > prevLen) setHasNewContent(true);
  }, [messages, userScrolledUp, scheduleScrollToEnd]);

  // -- Sessions --

  const loadSessions = useCallback(() => {
    if (!connected) return;
    request<{ sessions: SessionEntry[]; total: number }>('sessions.list', { limit: 100 })
      .then((res) => setSessions(res.sessions))
      .catch(() => {});
  }, [connected, request]);

  /**
   * Append an inline assistant error bubble. Two-world split — read carefully:
   *
   * **This path (RPC / client-side failures):** caller supplies the
   * user-visible text DIRECTLY. Use for RPC rejections, approval-resolve
   * failures, and other client-side issues where there's no backend
   * `errorType` available. Pass a Ghost-voiced English string — same tone
   * register as `inlineErrorText` (first-person, warm). Do NOT route through
   * `inlineErrorText()`; this path is precisely for cases where no enum
   * applies.
   *
   * **The OTHER path (`chat.error` events):** lives in `useChatEvents.ts`.
   * Backend emits `chat.error` with an `errorType` code; the handler narrows
   * via `isKnownErrorType`, calls `inlineErrorText(errorType)`, and appends
   * the resulting bubble. Drift between backend `GhostErrorType` and the
   * frontend mirror is caught by `tests/web/error-type-drift.test.ts`.
   *
   * The two paths produce the same visual shape (`type: 'error'` bubble);
   * the split exists because RPC failures don't carry an enum and would
   * otherwise need an "RPC_FAILED" pseudo-type that adds no signal.
   */
  const appendError = useCallback((text: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: text,
        timestamp: new Date(),
        type: 'error',
      },
    ]);
  }, []);

  const showToolCallsRef = useRef(showToolCalls);
  showToolCallsRef.current = showToolCalls;

  const loadHistory = useCallback(
    (key: string) => {
      if (!connected) return;
      setSessionLoading(true);
      request<{ sessionKey: string; messages: HistoryMessage[] }>('chat.history', {
        sessionKey: key,
        limit: 200,
      })
        .then((res) => {
          setMessages(historyToMessages(res.messages, showToolCallsRef.current));
          setSessionLoading(false);
        })
        .catch((err: unknown) => {
          // History load happens at mount before the user interacts — no UI
          // surface. Log to console for devtools diagnosis only.
          console.warn('Failed to load history:', err);
          setSessionLoading(false);
        });
    },
    [connected, request],
  );

  useEffect(() => {
    if (!connected) return;
    loadHistory(sessionKey);
    loadSessions();
    // Fetch debug preferences from gateway status
    request<{ showToolCalls?: boolean; paperMode?: boolean }>('status')
      .then((res) => {
        if (typeof res.showToolCalls === 'boolean') setShowToolCalls(res.showToolCalls);
        if (typeof res.paperMode === 'boolean') setPaperMode(res.paperMode);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  // -- Send --

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !connected) return;

      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'user', content: trimmed, timestamp: new Date() },
      ]);
      streamRef.current = [];
      setChatSending(true);

      const runId = crypto.randomUUID();
      setChatRunId(runId);
      chatRunIdRef.current = runId;
      setThinkingPhase('thinking');
      setThinkingDetail(null);

      request<{ runId: string; status: string }>('chat.send', {
        message: trimmed,
        sessionKey: sessionKeyRef.current,
        idempotencyKey: runId,
      })
        .then(() => setChatSending(false))
        .catch(() => {
          setChatSending(false);
          setChatRunId(null);
          chatRunIdRef.current = null;
          setThinkingPhase(null);
          setThinkingDetail(null);
          appendError("I couldn't send that — let me put it back in the queue and you can try again");
          setQueue((prev) => [...prev, { id: crypto.randomUUID(), text: trimmed }]);
        });
    },
    [connected, request, appendError],
  );

  const flushQueue = useCallback(() => {
    const q = queueRef.current;
    if (q.length === 0) return;
    setQueue((prev) => prev.slice(1));
    sendMessage(q[0].text);
  }, [sendMessage]);

  const removeFromQueue = useCallback((id: string) => {
    setQueue((prev) => prev.filter((q) => q.id !== id));
  }, []);

  const handleSend = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !connected) return;

      if (STOP_COMMANDS.has(trimmed.toLowerCase())) {
        request('chat.abort', { runId: chatRunIdRef.current ?? undefined }).catch((err: unknown) => {
          // Abort is best-effort — if the RPC fails the run will resolve on its
          // own via chat.done/chat.error. No inline bubble for this case.
          console.warn('Failed to abort:', err);
        });
        return;
      }

      if (chatRunIdRef.current !== null || chatSending) {
        setQueue((prev) => [...prev, { id: crypto.randomUUID(), text: trimmed }]);
        return;
      }

      sendMessage(trimmed);
    },
    [connected, request, chatSending, sendMessage],
  );

  const handleAbort = useCallback(() => {
    request('chat.abort', { runId: chatRunIdRef.current ?? undefined }).catch(() => {});
  }, [request]);

  const handleReconnect = useCallback(() => {
    if (client) {
      client.stop();
      client.start();
    }
  }, [client]);

  // -- Events --

  useChatEvents({
    subscribe, chatRunIdRef, streamRef, toolCallsRef, suppressResponseRef,
    setMessages, setChatRunId, setChatSending,
    setActiveToolCalls, setThinkingPhase, setThinkingDetail,
    loadSessions, flushQueue, showToolCalls,
  });

  // -- Session switching --

  const switchSession = useCallback(
    (key: string) => {
      if (key === sessionKey) {
        setSessionDropdownOpen(false);
        return;
      }
      setMessages([]);
      streamRef.current = [];
      toolCallsRef.current = new Map();
      setActiveToolCalls([]);
      setChatRunId(null);
      chatRunIdRef.current = null;
      setChatSending(false);
      setThinkingPhase(null);
      setThinkingDetail(null);
      setQueue([]);
      setSessionKey(key);
      sessionKeyRef.current = key;
      setSessionDropdownOpen(false);
      loadHistory(key);
    },
    [sessionKey, loadHistory],
  );

  const resolveApproval = useCallback((approvalId: string, decision: 'approved' | 'rejected', reason?: string) => {
    if (!connected) return;
    // Determine RPC method: tool approvals use tool.approval.resolve, trading uses trading.approval.resolve
    const msg = messages.find((m) => m.id === approvalId);
    const action = msg?.data?.action ?? '';
    const isToolApproval = ['exec', 'read_file', 'write_file', 'edit_file'].includes(action);
    const method = isToolApproval ? 'tool.approval.resolve' : 'trading.approval.resolve';
    const payload: { approvalId: string; decision: string; reason?: string } = { approvalId, decision };
    if (decision === 'rejected' && reason && reason.length > 0) payload.reason = reason;
    request(method, payload).catch(() => {
      const verb = decision === 'approved' ? 'approve' : 'reject';
      appendError(`I couldn't ${verb} that — try again in a moment`);
    });
  }, [connected, request, messages, appendError]);

  const handleApprove = useCallback((approvalId: string) => {
    resolveApproval(approvalId, 'approved');
  }, [resolveApproval]);

  const handleReject = useCallback((approvalId: string, reason?: string) => {
    resolveApproval(approvalId, 'rejected', reason);
  }, [resolveApproval]);

  const isBusy = chatRunId !== null || chatSending;
  const showEmptyState = messages.length === 0 && !chatRunId && !sessionLoading;

  return {
    messages, chatRunId,
    sessionKey, sessions, sessionDropdownOpen, setSessionDropdownOpen, sessionLoading,
    queue, activeToolCalls, userScrolledUp, hasNewContent,
    thinkingPhase, thinkingDetail,
    messagesEndRef, scrollContainerRef, scrollToBottom,
    handleSend, handleAbort, handleReconnect, handleApprove, handleReject,
    switchSession, removeFromQueue,
    connected, disconnected, isBusy, showEmptyState, paperMode,
  };
}
