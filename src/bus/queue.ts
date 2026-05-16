/** Async message bus. Decouples channels from agent. */

import type { InboundMessage, OutboundMessage } from "./types.js";

type Resolver<T> = (value: T) => void;

export class MessageBus {
  private readonly inbound: InboundMessage[] = [];
  private readonly outbound: OutboundMessage[] = [];
  private readonly inboundWaiters: Resolver<InboundMessage>[] = [];
  private readonly outboundWaiters: Resolver<OutboundMessage>[] = [];

  publishInbound(msg: InboundMessage): void {
    const waiter = this.inboundWaiters.shift();
    if (waiter) { waiter(msg); return; }
    this.inbound.push(msg);
  }

  consumeInbound(): Promise<InboundMessage> {
    const msg = this.inbound.shift();
    if (msg) return Promise.resolve(msg);
    return new Promise(resolve => this.inboundWaiters.push(resolve));
  }

  publishOutbound(msg: OutboundMessage): void {
    const waiter = this.outboundWaiters.shift();
    if (waiter) { waiter(msg); return; }
    this.outbound.push(msg);
  }

  consumeOutbound(): Promise<OutboundMessage> {
    const msg = this.outbound.shift();
    if (msg) return Promise.resolve(msg);
    return new Promise(resolve => this.outboundWaiters.push(resolve));
  }

  tryConsumeOutbound(): OutboundMessage | null {
    return this.outbound.shift() ?? null;
  }

  /** Discard any pending consume-waiters so stopped loops cannot steal messages
   *  from a subsequent `startAll` pass. The abandoned promises simply never
   *  resolve — they are eventually garbage-collected. */
  clearWaiters(): void {
    this.inboundWaiters.length = 0;
    this.outboundWaiters.length = 0;
  }

  get inboundSize(): number { return this.inbound.length; }
  get outboundSize(): number { return this.outbound.length; }
}
