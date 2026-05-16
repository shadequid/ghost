export type IndicatorKind = "overlay" | "subpane";

export interface IndicatorMeta {
  kind: IndicatorKind;
  label: string;
  color: string;
}

const registry: Record<string, IndicatorMeta> = {
  ema: { kind: "overlay", label: "EMA", color: "#f5c842" },
  bb: { kind: "overlay", label: "Bollinger Bands", color: "#7c4dff" },
  ichimoku: { kind: "overlay", label: "Ichimoku Cloud", color: "var(--color-success-default)" },
  keltner: { kind: "overlay", label: "Keltner Channel", color: "#ff7043" },
  rsi: { kind: "subpane", label: "RSI", color: "#ab47bc" },
  macd: { kind: "subpane", label: "MACD", color: "#42a5f5" },
  adx: { kind: "subpane", label: "ADX", color: "#ffa726" },
  stochrsi: { kind: "subpane", label: "StochRSI", color: "#ba68c8" },
  obv: { kind: "subpane", label: "OBV", color: "#4fc3f7" },
  williamsr: { kind: "subpane", label: "WilliamsR", color: "#ec407a" },
  cci: { kind: "subpane", label: "CCI", color: "#9ccc65" },
  atr: { kind: "subpane", label: "ATR", color: "#ffd54f" },
  vwap: { kind: "overlay", label: "VWAP", color: "#80deea" },
};

export const ALLOWED_INDICATOR_NAMES = new Set(Object.keys(registry));

export function getIndicatorMeta(name: string): IndicatorMeta | undefined {
  return registry[name.toLowerCase()];
}
