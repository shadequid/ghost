/**
 * Terminal-friendly formatters for trading data display.
 */

/** Format USD value with appropriate precision (locale-safe, always uses '.') */
export function formatUsd(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1000) {
    const int = Math.trunc(value);
    const dec = Math.abs(value - int).toFixed(2).slice(1);
    // Manual comma insertion to avoid locale issues
    const intStr = int.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return `$${intStr}${dec}`;
  }
  if (Math.abs(value) >= 1 || value === 0) return `$${value.toFixed(2)}`;
  if (Math.abs(value) >= 0.0001) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(6)}`;
}

/** Format percentage with sign */
export function formatPct(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

/** Format PnL with color hint (for terminal) */
export function formatPnl(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatUsd(value)}`;
}

/** Format leverage */
export function formatLeverage(value: number): string {
  return `${value}x`;
}

/** Format position direction */
export function formatSide(side: string): string {
  return side.toUpperCase();
}

/** Format a position as a readable text block */
export function formatPosition(pos: {
  symbol: string;
  side: string;
  size: number;
  entryPrice: number;
  markPrice: number;
  leverage: number;
  unrealizedPnl: number;
  liquidationPrice?: number | null;
  marginUsed?: number;
  marginMode?: string;
}): string {
  const modeLabel = pos.marginMode ? ` (${pos.marginMode})` : "";
  const lines = [
    `${pos.symbol} ${formatSide(pos.side)} ${formatLeverage(pos.leverage)}${modeLabel}`,
    `  Size: ${pos.size} | Entry: ${formatUsd(pos.entryPrice)} | Mark: ${formatUsd(pos.markPrice)}`,
    `  PnL: ${formatPnl(pos.unrealizedPnl)}`,
  ];
  if (pos.liquidationPrice !== null && pos.liquidationPrice !== undefined) lines.push(`  Liq: ${formatUsd(pos.liquidationPrice)}`);
  if (pos.marginUsed) lines.push(`  Margin: ${formatUsd(pos.marginUsed)}`);
  return lines.join("\n");
}

/** Format multiple positions as a summary */
export function formatPositions(positions: Array<{
  symbol: string;
  side: string;
  size: number;
  entryPrice: number;
  markPrice: number;
  leverage: number;
  unrealizedPnl: number;
  liquidationPrice?: number | null;
  marginUsed?: number;
  marginMode?: string;
}>): string {
  if (positions.length === 0) return "No open positions.";
  const totalPnl = positions.reduce((sum, p) => sum + p.unrealizedPnl, 0);
  const header = `${positions.length} open position(s) | Total PnL: ${formatPnl(totalPnl)}\n${"─".repeat(50)}`;
  const rows = positions.map(formatPosition);
  return [header, ...rows].join("\n\n");
}

/** Format balance/portfolio summary */
export function formatBalance(balance: {
  equity: number;
  availableMargin: number;
  totalMarginUsed: number;
  unrealizedPnl: number;
  positionCount: number;
}): string {
  return [
    `Portfolio Summary`,
    `${"─".repeat(30)}`,
    `Equity:     ${formatUsd(balance.equity)}`,
    `Available:  ${formatUsd(balance.availableMargin)}`,
    `Margin Used: ${formatUsd(balance.totalMarginUsed)}`,
    `Unrealized:  ${formatPnl(balance.unrealizedPnl)}`,
    `Positions:   ${balance.positionCount}`,
  ].join("\n");
}

/** Format order details */
export function formatOrder(order: {
  symbol: string;
  side: string;
  type: string;
  size: number;
  price?: number;
  triggerPrice?: number;
}): string {
  const priceStr = order.price ? ` @ ${formatUsd(order.price)}` : " @ Market";
  const triggerStr = order.triggerPrice ? ` (trigger: ${formatUsd(order.triggerPrice)})` : "";
  return `${order.symbol} ${formatSide(order.side)} ${order.type} ${order.size}${priceStr}${triggerStr}`;
}
