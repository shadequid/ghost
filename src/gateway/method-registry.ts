// src/gateway/method-registry.ts

export interface MethodContext {
  clientId: string;
  sessionId: string;
  broadcast: (event: string, payload: unknown) => void;
  emit: (event: string, payload: unknown) => void;
}

export type MethodHandler = (ctx: MethodContext, payload: unknown) => Promise<unknown>;

export class MethodRegistry {
  private readonly handlers = new Map<string, MethodHandler>();

  register(method: string, handler: MethodHandler): void {
    this.handlers.set(method, handler);
  }

  has(method: string): boolean {
    return this.handlers.has(method);
  }

  methods(): string[] {
    return [...this.handlers.keys()];
  }

  async dispatch(method: string, ctx: MethodContext, payload: unknown): Promise<unknown> {
    const handler = this.handlers.get(method);
    if (!handler) throw new MethodNotFoundError(method);
    return handler(ctx, payload);
  }
}

export class MethodNotFoundError extends Error {
  constructor(method: string) {
    super(`Method not found: ${method}`);
    this.name = "MethodNotFoundError";
  }
}
