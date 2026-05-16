// src/gateway/protocol.ts

/** Error codes for WS responses. */
export type ErrorCode = "UNAUTHORIZED" | "NOT_FOUND" | "BAD_REQUEST" | "INTERNAL" | "NOT_AVAILABLE";

// -- Client -> Server frames --------------------------------------------------

export interface ConnectFrame {
  type: "connect";
  token?: string;
}

export interface RequestFrame {
  type: "req";
  id: string;
  method: string;
  payload?: unknown;
}

export type ClientFrame = ConnectFrame | RequestFrame;

// -- Server -> Client frames --------------------------------------------------

export interface HelloFrame {
  type: "hello";
  sessionId: string;
}

export interface ResponseOkFrame {
  type: "res";
  id: string;
  ok: true;
  payload?: unknown;
}

export interface ResponseErrorFrame {
  type: "res";
  id: string;
  ok: false;
  error: { code: ErrorCode; message: string };
}

export type ResponseFrame = ResponseOkFrame | ResponseErrorFrame;

export interface ErrorFrame {
  type: "error";
  message: string;
}

export interface EventFrame {
  type: "event";
  event: string;
  payload?: unknown;
  seq: number;
}

export type ServerFrame = HelloFrame | ResponseFrame | ErrorFrame | EventFrame;

// -- Parsing ------------------------------------------------------------------

export function parseClientFrame(data: unknown): ClientFrame | null {
  if (data === null || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  if (obj.type === "connect") {
    return { type: "connect", token: typeof obj.token === "string" ? obj.token : undefined };
  }
  if (obj.type === "req" && typeof obj.id === "string" && typeof obj.method === "string") {
    return { type: "req", id: obj.id, method: obj.method, payload: obj.payload };
  }
  return null;
}

export function makeOk(id: string, payload?: unknown): ResponseOkFrame {
  return { type: "res", id, ok: true, payload };
}

export function makeError(id: string, code: ErrorCode, message: string): ResponseErrorFrame {
  return { type: "res", id, ok: false, error: { code, message } };
}

export function makeEvent(event: string, payload: unknown, seq: number): EventFrame {
  return { type: "event", event, payload, seq };
}
