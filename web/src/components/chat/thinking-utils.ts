/** Pure-logic helpers for ThinkingIndicator — separated for testability. */

import type { CSSProperties } from 'react';

export type ThinkingPhase = 'thinking' | 'fetching' | 'analyzing';

export const PHASE_LABELS: Record<ThinkingPhase, string> = {
  thinking: 'Thinking',
  fetching: 'Fetching data',
  analyzing: 'Analyzing',
};

export const TOOL_FRIENDLY_NAMES: Record<string, string> = {
  'get_price': 'price',
  'get_positions': 'positions',
  'get_balance': 'balance',
  'get_orders': 'orders',
  'market_overview': 'market',
  'get_funding_rates': 'funding',
  'get_indicators': 'indicators',
  'get_levels': 'support/resistance',
  'get_news': 'news',
  'get_trades': 'trade history',
  'place_order': 'placing order',
  'cancel_order': 'cancelling',
  'close_position': 'closing position',
  'set_leverage': 'leverage',
  'set_sl_tp': 'SL/TP',
};

export function formatLabel(phase: ThinkingPhase, detail?: string): string {
  if (phase === 'fetching' && detail) {
    const friendly = TOOL_FRIENDLY_NAMES[detail] ?? detail;
    return `${PHASE_LABELS.fetching} ${friendly}`;
  }
  return PHASE_LABELS[phase];
}

export const wrapperStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  whiteSpace: 'nowrap',
  fontFamily: '"JetBrains Mono", monospace',
  fontSize: "13px",
  color: 'var(--color-text-secondary)',
  transition: 'opacity 0.2s ease',
};

export const labelStyle: CSSProperties = {
  transition: 'opacity 0.15s ease',
};
