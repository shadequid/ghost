import { createContext, useContext } from "react";
import type { ChartDataResponse } from "@/lib/chartTypes";

export interface ChartDataStore {
  get: (key: string) => ChartDataResponse | undefined;
  find: (predicate: (d: ChartDataResponse) => boolean) => ChartDataResponse | undefined;
  set: (key: string, data: ChartDataResponse) => void;
}

export const ChartDataCtx = createContext<ChartDataStore | null>(null);

export function useChartDataStore(): ChartDataStore | null {
  return useContext(ChartDataCtx);
}

export function chartDataKey(
  symbol: string,
  interval: string | undefined,
  indicators: string | undefined,
): string {
  return `${symbol}|${interval ?? "4h"}|${indicators ?? ""}`;
}
