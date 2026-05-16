/**
 * TextAccumulator — tracks assistant text output across turns within a prompt run.
 *
 * Separates text accumulation concern from the Orchestrator's event handling.
 * Provides both total accumulated text and current-turn-only text.
 */
export class TextAccumulator {
  private accumulated = "";
  private turnTextOffset = 0;
  /** Chars delivered via text_delta within the current assistant message. */
  private streamedChars = 0;

  /** Text produced in the current turn only (since last turn_start). */
  get currentTurnText(): string {
    return this.accumulated.slice(this.turnTextOffset);
  }

  /** All text accumulated across all turns in this prompt run. */
  get totalText(): string {
    return this.accumulated;
  }

  /** Call on turn_start to begin tracking a new turn. */
  onTurnStart(): void {
    this.turnTextOffset = this.accumulated.length;
    this.streamedChars = 0;
  }

  /** Call on each text_delta to append streamed text. */
  onDelta(delta: string): void {
    this.accumulated += delta;
    this.streamedChars += delta.length;
  }

  /**
   * Call on message_end for assistant messages to capture any text that
   * was not delivered via text_delta events (pi-agent-core may skip deltas
   * for tool-use assistant messages).
   *
   * Uses offset-based tracking (streamedChars) — only the portion beyond
   * what was already delivered via deltas gets injected. Resets the per-message
   * counter for the next assistant message in the same turn.
   *
   * Returns the undelivered text portion, or null if all text was already
   * delivered via deltas.
   */
  onMessageEnd(messageText: string): string | null {
    if (!messageText) return null;
    const undelivered = messageText.slice(this.streamedChars);
    // Reset per-message counter for the next assistant message in this turn
    this.streamedChars = 0;
    if (!undelivered) return null;
    this.accumulated += undelivered;
    return undelivered;
  }

  /** Reset for a new prompt run. */
  reset(): void {
    this.accumulated = "";
    this.turnTextOffset = 0;
    this.streamedChars = 0;
  }
}
