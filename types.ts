
export enum AssetType {
  STOCKS = 'STOCKS',
  MUTUAL_FUNDS = 'MUTUAL_FUNDS',
  GOLD = 'GOLD',
  FIXED_DEPOSIT = 'FIXED_DEPOSIT'
}

export interface Investment {
  id: string;
  name: string;
  type: AssetType;
  trackingSymbol?: string;
  displaySymbol?: string;
  memberIds?: string[];
  investedAmount: number;
  currentValue: number;
  quantity: number;
  purchasePrice: number;
  purchaseDate: string;
  lastUpdated: string;
  // Period start prices for real-time returns
  priceStartOfDay?: number;
  priceStartOfWeek?: number;
  priceStartOfMonth?: number;
  interestRate?: number;
  tenureYears?: number;
  isSip?: boolean;
  sipAmount?: number;
  sipDay?: number;
  sipFrequency?: "MONTHLY";
}

export interface Goal {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
}

export interface PortfolioSummary {
  totalInvested: number;
  totalCurrentValue: number;
  overallGain: number;
  overallGainPercentage: number;
  todayReturn: number;
  weekReturn: number;
  monthReturn: number;
}

export type ViewState = 'HOME' | 'REPORTS' | 'AI_HUB' | 'ASSET_DETAIL' | 'HOLDING_DETAIL' | 'ADD_FLOW' | 'SETTINGS';

export interface UserProfile {
  name: string;
  currency: string;
}
