// SYNC: This file must stay in sync with web/src/lib/chartTypes.ts (frontend mirror).

export interface ChartCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface ChartVolume {
  time: number;
  value: number;
  color: string;
}

export interface ChartLineOverlay {
  label: string;
  color: string;
  data: Array<{ time: number; value: number }>;
}

export interface ChartBandOverlay {
  label: string;
  color: string;
  upperData: Array<{ time: number; value: number }>;
  lowerData: Array<{ time: number; value: number }>;
}

export interface ChartLevel {
  price: number;
  label: string;
  side: "support" | "resistance";
}

export interface ChartSubPane {
  label: string;
  type: "line" | "macd";
  color: string;
  data: Array<{ time: number; value: number }>;
  signalData?: Array<{ time: number; value: number }>;
  histogramData?: Array<{ time: number; value: number; color: string }>;
  zones?: Array<{ value: number; color: string }>;
}

export interface ChartDataResponse {
  symbol: string;
  interval: string;
  candles: ChartCandle[];
  volumes: ChartVolume[];
  lineOverlays: ChartLineOverlay[];
  bandOverlays: ChartBandOverlay[];
  levels: ChartLevel[];
  subPanes: ChartSubPane[];
}
