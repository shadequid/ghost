// src/gateway/client-manager.ts
import type { Logger } from "pino";
import { makeEvent } from "./protocol.js";

export interface ConnectedClient {
  id: string;
  sessionId: string;
  ws: { send(data: string): void };
  connectedAt: number;
  seq: number;
}

export class ClientManager {
  private readonly clients = new Map<string, ConnectedClient>();
  private readonly _countListeners = new Set<(count: number) => void>();

  constructor(private readonly logger: Logger) {}

  onCountChange(fn: (count: number) => void): void {
    this._countListeners.add(fn);
  }

  add(client: ConnectedClient): void {
    this.clients.set(client.id, client);
    for (const fn of this._countListeners) fn(this.clients.size);
  }

  remove(id: string): void {
    this.clients.delete(id);
    for (const fn of this._countListeners) fn(this.clients.size);
  }

  get(id: string): ConnectedClient | undefined {
    return this.clients.get(id);
  }

  get count(): number {
    return this.clients.size;
  }

  emit(clientId: string, event: string, payload: unknown): void {
    const client = this.clients.get(clientId);
    if (!client) return;
    client.seq++;
    try {
      client.ws.send(JSON.stringify(makeEvent(event, payload, client.seq)));
    } catch (err) {
      this.logger.warn({ err, clientId }, "ws.send failed on emit — evicting");
      this.remove(clientId);
    }
  }

  broadcast(event: string, payload: unknown): void {
    const dead: string[] = [];
    for (const [id, client] of this.clients) {
      client.seq++;
      try {
        client.ws.send(JSON.stringify(makeEvent(event, payload, client.seq)));
      } catch (err) {
        this.logger.warn({ err, clientId: id }, "ws.send failed on broadcast — evicting");
        dead.push(id);
      }
    }
    for (const id of dead) this.remove(id);
  }
}
