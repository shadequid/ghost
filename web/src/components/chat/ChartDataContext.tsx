import { useCallback, useState, type ReactNode } from "react";
import type { ChartDataResponse } from "@/lib/chartTypes";
import { ChartDataCtx } from "./ChartDataContext-internals";

export function ChartDataProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<Map<string, ChartDataResponse>>(
    () => new Map(),
  );

  const get = useCallback(
    (key: string) => store.get(key),
    [store],
  );

  const find = useCallback(
    (predicate: (d: ChartDataResponse) => boolean) => {
      for (const d of store.values()) {
        if (predicate(d)) return d;
      }
      return undefined;
    },
    [store],
  );

  const set = useCallback(
    (key: string, data: ChartDataResponse) => {
      setStore((prev) => {
        if (prev.get(key) === data) return prev;
        const next = new Map(prev);
        next.set(key, data);
        return next;
      });
    },
    [],
  );

  return (
    <ChartDataCtx.Provider value={{ get, find, set }}>
      {children}
    </ChartDataCtx.Provider>
  );
}
