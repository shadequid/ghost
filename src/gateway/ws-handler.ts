// src/gateway/ws-handler.ts
import type { AnyElysia } from "elysia";
import type { ElysiaWS } from "elysia/ws";
import { parseClientFrame, makeOk, makeError, type ErrorCode } from "./protocol.js";
import { MethodNotFoundError, type MethodContext } from "./method-registry.js";
import type { MethodRegistry } from "./method-registry.js";
import type { ClientManager } from "./client-manager.js";
import { RateLimiter } from "./rate-limit.js";
import type { EventBus } from "../bus/events.js";
import { ClientEvents } from "../events/client-events.js";

interface WsHandlerDeps {
  registry: MethodRegistry;
  clientManager: ClientManager;
  eventBus: EventBus;
  rateLimitRpm?: number;
  onClientDisconnect?: (clientId: string) => void;
}

/** Track connection state per socket. */
const socketState = new WeakMap<
  object,
  { connected: boolean; clientId: string; sessionId: string }
>();

export function registerWsHandler(app: AnyElysia, deps: WsHandlerDeps): AnyElysia {
  const rateLimiter = new RateLimiter(deps.rateLimitRpm ?? 100);

  return app.ws("/ws", {
    open(ws: ElysiaWS) {
      const clientId = crypto.randomUUID();
      socketState.set(ws.data as object, { connected: false, clientId, sessionId: "" });
    },

    async message(ws: ElysiaWS, rawMsg: unknown) {
      const parsed = typeof rawMsg === "object" && rawMsg !== null
        ? rawMsg as Record<string, unknown>
        : (() => { try { return JSON.parse(rawMsg as string); } catch { return null; } })();

      const frame = parseClientFrame(parsed);
      if (!frame) {
        ws.send(JSON.stringify({ type: "error", message: "Invalid frame" }));
        return;
      }

      const state = socketState.get(ws.data as object);
      if (!state) {
        ws.send(JSON.stringify({ type: "error", message: "Session lost — reconnect" }));
        ws.close();
        return;
      }

      // Handle connect frame — no token required, gateway has no in-app auth.
      if (frame.type === "connect") {
        if (state.connected) {
          ws.send(JSON.stringify({ type: "error", message: "Already connected" }));
          return;
        }

        const sessionId = "ws_" + Math.random().toString(36).slice(2, 18);

        state.connected = true;
        state.sessionId = sessionId;

        deps.clientManager.add({
          id: state.clientId,
          sessionId,
          ws: { send: (data: string) => ws.send(data) },
          connectedAt: Date.now(),
          seq: 0,
        });

        deps.eventBus.publish(ClientEvents.connected({ clients: deps.clientManager.count }));
        ws.send(JSON.stringify({ type: "hello", sessionId }));
        return;
      }

      // Request frame — must have sent connect frame first.
      if (!state.connected) {
        ws.send(JSON.stringify(makeError(frame.id, "UNAUTHORIZED", "Send connect frame first")));
        return;
      }

      if (!rateLimiter.check(state.clientId)) {
        ws.send(JSON.stringify(makeError(frame.id, "BAD_REQUEST", "Rate limit exceeded")));
        return;
      }

      const ctx: MethodContext = {
        clientId: state.clientId,
        sessionId: state.sessionId,
        broadcast: (event, payload) => deps.clientManager.broadcast(event, payload),
        emit: (event, payload) => deps.clientManager.emit(state.clientId, event, payload),
      };

      try {
        const result = await deps.registry.dispatch(frame.method, ctx, frame.payload);
        ws.send(JSON.stringify(makeOk(frame.id, result)));
      } catch (err) {
        let code: ErrorCode = "INTERNAL";
        if (err instanceof MethodNotFoundError) code = "NOT_FOUND";
        else if (err instanceof Error && err.message.includes("is required")) code = "BAD_REQUEST";
        // Surface domain-typed error codes (e.g. TelegramSetupError) by
        // JSON-encoding them into the message field. Web clients that know
        // the convention can JSON.parse the message to recover { code, message }
        // for localized copy; clients that don't fall back to displaying the
        // raw message string. Keeps the wire protocol unchanged while letting
        // i18n layers map a stable code to user-friendly text.
        const errObj = err as { toJSON?: () => unknown; message?: string };
        const msg = typeof errObj.toJSON === "function"
          ? JSON.stringify(errObj.toJSON())
          : (err as Error).message;
        ws.send(JSON.stringify(makeError(frame.id, code, msg)));
      }
    },

    close(ws: ElysiaWS) {
      const state = socketState.get(ws.data as object);
      if (state?.connected) {
        deps.onClientDisconnect?.(state.clientId);
        deps.clientManager.remove(state.clientId);
        deps.eventBus.publish(ClientEvents.disconnected({ clients: deps.clientManager.count }));
      }
      socketState.delete(ws.data as object);
    },
  });
}
