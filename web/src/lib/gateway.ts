// Gateway WebSocket client — single WS connection to /ws with method-based RPC.
// Protocol: connect frame -> hello response -> req/res correlation.

export interface EventFrame {
  type: 'event';
  event: string;
  payload?: unknown;
  seq: number;
}

export interface ResponseOk {
  type: 'res';
  id: string;
  ok: true;
  payload?: unknown;
}

export interface ResponseError {
  type: 'res';
  id: string;
  ok: false;
  error: { code: string; message: string };
}

export type ResponseFrame = ResponseOk | ResponseError;

interface HelloFrame {
  type: 'hello';
  sessionId: string;
}

interface ErrorFrame {
  type: 'error';
  message: string;
}

type ServerFrame = HelloFrame | ResponseFrame | ErrorFrame | EventFrame;

export interface GatewayClientOptions {
  url?: string;
  onEvent?: (evt: EventFrame) => void;
  onHello?: (hello: { sessionId: string }) => void;
  onClose?: () => void;
  onError?: (msg: string) => void;
}

const INITIAL_BACKOFF_MS = 800;
const MAX_BACKOFF_MS = 15_000;
const BACKOFF_FACTOR = 1.7;

export class GatewayClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private seq = 0;
  private backoffMs = INITIAL_BACKOFF_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionallyClosed = false;
  private _connected = false;

  private readonly url: string;
  private readonly opts: GatewayClientOptions;

  constructor(opts: GatewayClientOptions = {}) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.url = opts.url ?? `${protocol}//${window.location.host}/ws`;
    this.opts = opts;
  }

  get connected(): boolean {
    return this._connected;
  }

  start(): void {
    this.intentionallyClosed = false;
    this.connect();
  }

  stop(): void {
    this.intentionallyClosed = true;
    this.clearReconnectTimer();
    this.rejectAllPending('Client stopped');
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._connected = false;
  }

  request<T = unknown>(method: string, payload?: unknown, timeoutMs = 30_000): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Gateway not connected'));
    }

    const id = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (v: unknown) => { clearTimeout(timer); resolve(v as T); },
        reject: (e: Error) => { clearTimeout(timer); reject(e); },
      });
      this.ws!.send(JSON.stringify({ type: 'req', id, method, payload }));
    });
  }

  private connect(): void {
    this.clearReconnectTimer();

    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.ws!.send(JSON.stringify({ type: 'connect' }));
    };

    this.ws.onmessage = (ev: MessageEvent) => {
      let frame: ServerFrame;
      try {
        frame = JSON.parse(ev.data as string) as ServerFrame;
      } catch {
        return;
      }
      this.handleFrame(frame);
    };

    this.ws.onclose = () => {
      this._connected = false;
      this.rejectAllPending('Connection closed');
      this.opts.onClose?.();
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // onclose will fire after onerror
    };
  }

  private handleFrame(frame: ServerFrame): void {
    switch (frame.type) {
      case 'hello':
        this._connected = true;
        this.backoffMs = INITIAL_BACKOFF_MS;
        this.opts.onHello?.({ sessionId: frame.sessionId });
        break;

      case 'res': {
        const pending = this.pending.get(frame.id);
        if (!pending) break;
        this.pending.delete(frame.id);
        if (frame.ok) {
          pending.resolve(frame.payload);
        } else {
          pending.reject(new Error(frame.error.message));
        }
        break;
      }

      case 'event': {
        const evtFrame = frame as EventFrame;
        if (evtFrame.seq > this.seq) {
          this.seq = evtFrame.seq;
        }
        this.opts.onEvent?.(evtFrame);
        break;
      }

      case 'error':
        this.opts.onError?.(frame.message);
        break;
    }
  }

  private scheduleReconnect(): void {
    if (this.intentionallyClosed) return;
    this.clearReconnectTimer();

    this.reconnectTimer = setTimeout(() => {
      this.backoffMs = Math.min(this.backoffMs * BACKOFF_FACTOR, MAX_BACKOFF_MS);
      this.connect();
    }, this.backoffMs);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private rejectAllPending(reason: string): void {
    for (const [id, pending] of this.pending) {
      pending.reject(new Error(reason));
      this.pending.delete(id);
    }
  }
}
