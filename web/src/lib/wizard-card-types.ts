export type WizardCardSide = 'long' | 'short';
export type WizardCardOrderType = 'market' | 'limit';
export type WizardRowTone = 'risk' | 'reward' | 'muted';

export interface WizardOpenPosition {
  kind: 'open_position';
  symbol: string;
  side: WizardCardSide;
  leverage: number;
  size: number;
  orderType: WizardCardOrderType;
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
}

export interface WizardGenericRow {
  label: string;
  value: string;
  tone?: WizardRowTone;
}

export interface WizardGenericGroup {
  label?: string;
  rows: WizardGenericRow[];
}

export interface WizardGeneric {
  kind: 'generic';
  groups: WizardGenericGroup[];
}

export type WizardCardData = WizardOpenPosition | WizardGeneric;
