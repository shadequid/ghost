/** Non-component helpers extracted from ChartWidget.tsx so that the .tsx
 * file can satisfy react-refresh/only-export-components (HMR needs files
 * that export a component to only export components). */

/** Convert band fill color to a line color. Handles rgba, rgb, and hex formats. */
export function toBandLineColor(color: string): string {
  if (color.startsWith("rgba(")) return color;
  if (color.startsWith("#")) return color;
  if (color.startsWith("rgb(")) {
    return color.replace("rgb(", "rgba(").replace(")", ", 0.5)");
  }
  return color;
}

/** Focus spec for filtering the main chart to a single indicator or level. */
export type FocusSpec =
  | { kind: "indicator"; name: string }
  | { kind: "level"; price: number };

// ---------------------------------------------------------------------------
// Legend key helpers — stable identifiers for toggle state
// ---------------------------------------------------------------------------

export const lineKey = (label: string) => `line:${label}`;
export const bandKey = (label: string) => `band:${label}`;
export const levelKey = (price: number) => `level:${price}`;

export interface VisibleLevel {
  price: number;
  label: string;
  side?: "support" | "resistance";
  /** True when the level is the current focus target — rendered emphasized. */
  isTarget: boolean;
}
