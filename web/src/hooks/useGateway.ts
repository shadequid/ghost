import { useState, useEffect, useRef, useCallback, createContext, useContext } from 'react';
import { GatewayClient, type EventFrame, type GatewayClientOptions } from '../lib/gateway';

export type GatewayStatus = 'disconnected' | 'connecting' | 'connected';

export interface GatewayContextValue {
  client: GatewayClient | null;
  connected: boolean;
  sessionId: string | null;
  error: string | null;
  request: <T = unknown>(method: string, payload?: unknown) => Promise<T>;
  subscribe: (handler: (evt: EventFrame) => void) => () => void;
}

export const GatewayContext = createContext<GatewayContextValue | null>(null);

/** Access the gateway context. Throws if used outside GatewayProvider. */
export function useGateway(): GatewayContextValue {
  const ctx = useContext(GatewayContext);
  if (!ctx) {
    throw new Error('useGateway must be used within a GatewayProvider');
  }
  return ctx;
}

/** Hook that creates and manages a GatewayClient. Used inside GatewayProvider. */
export function useGatewayClient(opts?: GatewayClientOptions): GatewayContextValue {
  const [connected, setConnected] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<GatewayClient | null>(null);
  const eventHandlersRef = useRef<Set<(evt: EventFrame) => void>>(new Set());

  useEffect(() => {
    const client = new GatewayClient({
      ...opts,
      onHello: (hello) => {
        setConnected(true);
        setSessionId(hello.sessionId);
        setError(null);
      },
      onClose: () => {
        setConnected(false);
      },
      onError: (msg) => {
        setError(msg);
      },
      onEvent: (evt) => {
        for (const handler of eventHandlersRef.current) {
          handler(evt);
        }
      },
    });

    clientRef.current = client;
    client.start();

    return () => {
      client.stop();
      clientRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const request = useCallback(<T = unknown>(method: string, payload?: unknown): Promise<T> => {
    const client = clientRef.current;
    if (!client) return Promise.reject(new Error('Gateway not initialized'));
    return client.request<T>(method, payload);
  }, []);

  const subscribe = useCallback((handler: (evt: EventFrame) => void): (() => void) => {
    eventHandlersRef.current.add(handler);
    return () => {
      eventHandlersRef.current.delete(handler);
    };
  }, []);

  return {
    client: clientRef.current,
    connected,
    sessionId,
    error,
    request,
    subscribe,
  };
}
