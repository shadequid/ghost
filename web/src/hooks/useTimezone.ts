import { useState, useEffect, useCallback } from 'react';
import { useGateway } from './useGateway';

export interface TimezoneState {
  tz: string | null;
  loading: boolean;
  error: string | null;
}

export interface UseTimezoneResult extends TimezoneState {
  set: (tz: string) => Promise<{ ok: boolean; error?: string }>;
  refetch: () => void;
}

export function useTimezone(): UseTimezoneResult {
  const { connected, request } = useGateway();
  const [state, setState] = useState<TimezoneState>({ tz: null, loading: false, error: null });

  const fetchTz = useCallback(() => {
    if (!connected) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    let cancelled = false;
    request<{ tz: string }>('config.timezone.get')
      .then((r) => {
        if (cancelled) return;
        setState({ tz: r.tz, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState((s) => ({
          ...s,
          loading: false,
          error: err instanceof Error ? err.message : 'Failed to load timezone',
        }));
      });
    return () => { cancelled = true; };
  }, [connected, request]);

  useEffect(() => { fetchTz(); }, [fetchTz]);

  const set = useCallback(
    async (tz: string): Promise<{ ok: boolean; error?: string }> => {
      try {
        const r = await request<{ ok: boolean; tz?: string; error?: string }>(
          'config.timezone.set',
          { tz },
        );
        if (r.ok && r.tz) {
          setState({ tz: r.tz, loading: false, error: null });
        }
        return r.ok ? { ok: true } : { ok: false, error: r.error ?? 'Unknown error' };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Request failed' };
      }
    },
    [request],
  );

  return { ...state, set, refetch: fetchTz };
}
