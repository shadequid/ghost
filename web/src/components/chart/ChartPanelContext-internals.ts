import { createContext, useContext } from "react";
import type { FocusSpec } from "./ChartWidget-helpers";

export type { FocusSpec };

export interface ChartPanelRequest {
  symbol: string;
  interval?: string;
  focus?: FocusSpec;
}

export interface ChartPanelStore {
  request: ChartPanelRequest | null;
  open: (request: ChartPanelRequest) => void;
  close: () => void;
}

export const ChartPanelCtx = createContext<ChartPanelStore | null>(null);

export function useChartPanel(): ChartPanelStore | null {
  return useContext(ChartPanelCtx);
}
