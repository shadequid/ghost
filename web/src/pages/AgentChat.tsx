import { useState, useCallback, useEffect } from 'react';
import { useAgentChat } from '@/hooks/useAgentChat';
import { ChatInput } from '@/components/chat/ChatInput';
import { ActionCard } from '@/components/chat/ActionCard';
import { AskCard } from '@/components/chat/AskCard';
import { SuggestionChips, EmptyState } from '@/components/chat/SuggestionChips';
import { ErrorBanner } from '@/components/chat/ErrorBanner';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { ScrollIndicator } from '@/components/chat/ScrollIndicator';
import { PulsingDots } from '@/components/chat/PulsingDots';
import { ThinkingIndicator } from '@/components/chat/ThinkingIndicator';
import { ToolCallChips } from '@/components/chat/ToolCallChips';
import { ToolCallPanel } from '@/components/chat/ToolCallPanel';
import type { ToolCallEntry } from '@/lib/chatTypes';
import { errorRetryText } from '@/lib/error-retry-text';

export default function AgentChat() {
  const chat = useAgentChat();
  const [panelEntry, setPanelEntry] = useState<ToolCallEntry | null>(null);
  const [hasWallet, setHasWallet] = useState(false);

  useEffect(() => {
    const check = () => {
      fetch("/api/wallets").then((r) => r.json()).then((ws: unknown[]) => setHasWallet(ws.length > 0)).catch(() => {});
    };
    check();
    window.addEventListener("ghost-wallet-changed", check);
    return () => window.removeEventListener("ghost-wallet-changed", check);
  }, []);
  const idlePlaceholder = 'How can I help you today?';

  const pendingConfirm = chat.messages.find(
    (m) =>
      (m.type === 'confirmation' && m.status === 'pending') ||
      (m.type === 'action' && (m.actionStatus ?? 'pending') === 'pending'),
  );
  // Detach the pending action card from the message stream and dock it in
  // the ChatInput slot — keeps the interactive card at the user's gaze line
  // instead of pinned to the assistant bubble that triggered it.
  const pendingActionMessage =
    pendingConfirm?.type === 'action' && pendingConfirm.actionData
      ? pendingConfirm
      : null;
  // Same docking treatment for an in-flight <ask> wizard. Picks the most
  // recent assistant message whose AskCard hasn't been answered yet.
  // Pending action (post-tool approval) takes priority over a pending ask
  // when both exist.
  const pendingAskMessage = pendingActionMessage
    ? null
    : [...chat.messages].reverse().find(
        (m) =>
          m.role === 'assistant'
          && !!m.askBlocks
          && m.askBlocks.length > 0
          && !m.askSubmitted,
      ) ?? null;

  const handleToolCallSelect = useCallback((entry: ToolCallEntry) => {
    setPanelEntry(entry);
  }, []);

  const handlePanelClose = useCallback(() => {
    setPanelEntry(null);
  }, []);

  return (
    <section className="flex flex-col h-full bg-[var(--color-surface-scrim)] overflow-hidden pt-6">
      {chat.disconnected && (
        <ErrorBanner raw="connection closed" onRetry={chat.handleReconnect} />
      )}

      {/* Messages — when empty, the welcome state sits centered in the
          available space (Figma 215:1296). When there are messages, the
          stream anchors at the top and scrolls naturally. */}
      <div
        ref={chat.scrollContainerRef}
        className="flex-1 overflow-y-auto px-4 flex flex-col relative"
        style={{ scrollbarGutter: 'stable' }}
      >
        <div
          className={
            'max-w-[800px] w-full mx-auto flex flex-col gap-3' +
            (chat.showEmptyState ? ' flex-1 justify-center' : '')
          }
        >
          {chat.sessionLoading && (
            <div className="flex items-center justify-center h-full">
              <PulsingDots />
            </div>
          )}

          {chat.showEmptyState && <EmptyState hasWallet={hasWallet} />}

          {chat.messages.map((msg, idx) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              onAction={chat.handleSend}
              onApprove={chat.handleApprove}
              onReject={chat.handleReject}
              onToolCallSelect={handleToolCallSelect}
              onRetry={chat.handleSend}
              errorRetryText={errorRetryText(chat.messages, idx)}
            />
          ))}

          {chat.chatRunId && !chat.messages.some(
            (m) =>
              (m.type === 'confirmation' && m.status === 'pending') ||
              (m.type === 'action' && (m.actionStatus ?? 'pending') === 'pending'),
          ) && (
            <>
              <ThinkingIndicator phase={chat.thinkingPhase ?? 'thinking'} detail={chat.thinkingDetail ?? undefined} />
              {chat.activeToolCalls.length > 0 && (
                <ToolCallChips toolCalls={chat.activeToolCalls} onSelect={handleToolCallSelect} />
              )}
            </>
          )}

          <div ref={chat.messagesEndRef} />
        </div>
      </div>
      <div className="relative h-0 z-10">
        <div className="absolute -top-3 inset-x-0 px-4 flex justify-center pointer-events-none -translate-y-full">
          <div className="w-full max-w-[800px] flex justify-end">
            <ScrollIndicator visible={chat.userScrolledUp} hasNew={chat.hasNewContent} onClick={chat.scrollToBottom} />
          </div>
        </div>
      </div>

      {/* Queue */}
      {chat.queue.length > 0 && (
        <div className="border-t border-[var(--color-border-default)] bg-[var(--color-surface-base)] px-4 py-2 flex flex-col items-center">
          <div className="max-w-[800px] w-full">
            <div className="text-caption text-[var(--color-text-secondary)] mb-1">Queued ({chat.queue.length})</div>
            {chat.queue.map((q) => (
              <div
                key={q.id}
                className="flex items-center justify-between bg-[var(--color-surface-canvas)] rounded-[4px] px-2.5 py-1.5 text-body-sm text-[var(--color-text-secondary)] mb-1"
              >
                <span className="overflow-hidden text-ellipsis whitespace-nowrap mr-2">{q.text}</span>
                <button
                  onClick={() => chat.removeFromQueue(q.id)}
                  aria-label="Remove from queue"
                  className="bg-transparent border-0 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] focus-visible:text-[var(--color-text-primary)] cursor-pointer flex-shrink-0 p-0.5 transition-colors duration-fast ease-out"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {chat.showEmptyState && !chat.isBusy && (
        <div className="px-5 pt-3 pb-2 flex justify-center">
          <div className="max-w-[800px] w-full">
            <SuggestionChips onSelect={chat.handleSend} hasWallet={hasWallet} />
          </div>
        </div>
      )}

      {/*
       * Confirm UX v2: while a confirm is pending the card itself owns
       * BOTH the action affordance (Confirm / Cancel) AND the free-text
       * "discuss more" input on row 3. The bottom ChatInput is hidden so
       * the trader's eyes don't have to ping-pong between the card and a
       * second input. As soon as the confirm resolves (any status that
       * isn't `pending`), ChatInput is brought back. This supersedes the
       * earlier bugfix policy of keeping the input always mounted.
       */}
      {pendingActionMessage && pendingActionMessage.actionData ? (
        <div className="flex justify-center px-4 pt-2 pb-4 bg-[var(--color-surface-scrim)]">
          <div className="w-full max-w-[800px]">
            <ActionCard
              data={pendingActionMessage.actionData}
              status={pendingActionMessage.actionStatus ?? 'pending'}
              onApprove={chat.handleApprove}
              onReject={chat.handleReject}
            />
          </div>
        </div>
      ) : pendingAskMessage && pendingAskMessage.askBlocks && pendingAskMessage.askBlocks[0] ? (
        <div className="flex justify-center px-4 pt-2 pb-4 bg-[var(--color-surface-scrim)]">
          <div className="w-full max-w-[800px]">
            <AskCard
              block={pendingAskMessage.askBlocks[0]}
              onSubmit={(reply) => chat.handleSubmitAsk(pendingAskMessage.id, reply)}
              onDismiss={() => chat.handleDismissAsk(pendingAskMessage.id)}
            />
          </div>
        </div>
      ) : !pendingConfirm ? (
        <ChatInput
          onSend={chat.handleSend}
          disabled={!chat.connected}
          placeholder={
            !chat.connected
              ? 'Connecting…'
              : chat.messages.length === 0
                ? idlePlaceholder
                : 'Write a message'
          }
          isBusy={chat.isBusy}
          onAbort={chat.handleAbort}
        />
      ) : null}

      <ToolCallPanel entry={panelEntry} onClose={handlePanelClose} />
    </section>
  );
}
