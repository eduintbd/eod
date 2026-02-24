// Database types matching Supabase schema

export interface Client {
  client_id: string;
  bo_id: string | null;
  client_code: string | null;
  name: string | null;
  category: 'retail' | 'institution' | 'foreign' | null;
  income_status: string | null;
  is_margin_eligible: boolean;
  margin_eligibility_date: string | null;
  rm_id: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  status: 'active' | 'suspended' | 'closed' | 'pending_review';
  kyc_completed: boolean;
  account_type: 'Cash' | 'Margin' | null;
  commission_rate: number | null;
  department: string | null;
  created_at: string;
  updated_at: string;
}

export interface Security {
  isin: string;
  security_code: string | null;
  company_name: string | null;
  asset_class: 'EQ' | 'MF' | 'BOND' | 'GOVT' | null;
  category: 'A' | 'B' | 'Z' | 'N' | 'G' | 'S' | null;
  board: string | null;
  lot_size: number;
  face_value: number | null;
  sector: string | null;
  last_close_price: number | null;
  is_marginable: boolean;
  status: 'active' | 'suspended';
}

export interface RawTrade {
  id?: number;
  source: 'DSE' | 'CSE';
  file_name: string;
  action: string | null;
  status: string | null;
  order_id: string | null;
  ref_order_id: string | null;
  side: 'B' | 'S' | null;
  bo_id: string | null;
  client_code: string | null;
  isin: string | null;
  security_code: string | null;
  board: string | null;
  trade_date: string | null;
  trade_time: string | null;
  quantity: number | null;
  price: number | null;
  value: number | null;
  exec_id: string | null;
  session: string | null;
  fill_type: string | null;
  category: string | null;
  asset_class: string | null;
  compulsory_spot: boolean;
  trader_dealer_id: string | null;
  owner_dealer_id: string | null;
  raw_data: Record<string, unknown> | null;
  processed: boolean;
  import_audit_id?: number;
}

export interface TradeExecution {
  exec_id: string;
  order_id: string | null;
  client_id: string;
  isin: string;
  exchange: 'DSE' | 'CSE';
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  value: number;
  trade_date: string;
  trade_time: string | null;
  settlement_date: string | null;
  session: string | null;
  fill_type: string | null;
  category: string | null;
  board: string | null;
  commission: number;
  exchange_fee: number;
  cdbl_fee: number;
  ait: number;
  net_value: number;
  created_at: string;
}

export interface Holding {
  client_id: string;
  isin: string;
  quantity: number;
  average_cost: number;
  total_invested: number;
  realized_pl: number;
  as_of_date: string;
  updated_at: string;
  // Joined fields
  security?: Security;
}

export interface CashLedgerEntry {
  id: number;
  client_id: string;
  transaction_date: string;
  value_date: string | null;
  amount: number;
  running_balance: number;
  type: string;
  reference: string | null;
  narration: string | null;
  created_at: string;
}

export interface ImportAudit {
  id: number;
  file_name: string;
  file_type: 'ADMIN_BALANCE' | 'DSE_TRADE' | 'CSE_TRADE' | 'DEPOSIT_WITHDRAWAL' | 'PRICE_DATA';
  import_date: string;
  data_date: string | null;
  total_rows: number;
  processed_rows: number;
  rejected_rows: number;
  error_details: Record<string, unknown> | null;
  status: 'PROCESSING' | 'SUCCESS' | 'PARTIAL' | 'FAILED';
  imported_by: string | null;
}

// === Market Data types (from source project: ucb csm, schema: dse_market_data) ===

export interface DailyStockEod {
  id: string;
  symbol: string;
  date: string;
  close: number;
  volume: number;
  total_shares: number | null;
  category: string | null;
  sector: string | null;
  pe: number | null;
  created_at: string;
}

export interface HistoricalPrice {
  id: string | null;
  symbol: string | null;
  date: string | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface StockFundamental {
  id: string;
  symbol: string;
  market_cap: number | null;
  authorized_cap: number | null;
  paid_up_cap: number | null;
  face_value: number | null;
  total_shares: number | null;
  pe: number | null;
  nav: number | null;
  listing_year: number | null;
  year_high: number | null;
  year_low: number | null;
  last_agm: string | null;
  sector: string | null;
  category: string | null;
  created_at: string;
  updated_at: string;
}

// Parser output types
export interface ParsedAdminBalance {
  clients: Array<{
    bo_id: string;
    client_code: string;
    name: string;
    account_type: 'Cash' | 'Margin';
    commission_rate: number;
    rm_name: string | null;
    rm_id: string | null;
    rm_email: string | null;
    department: string | null;
    ledger_balance: number;
    matured_balance: number;
  }>;
  holdings: Array<{
    client_code: string;
    bo_id: string;
    security_code: string;
    quantity: number;
    saleable: number;
    average_cost: number;
    total_cost: number;
    market_value: number;
  }>;
}

export interface ParsedDeposit {
  bo_id: string | null;
  client_code: string | null;
  transaction_date: string;
  amount: number;
  type: string;
  reference: string | null;
  narration: string | null;
}

// === Margin & Risk types ===

export interface MarginAccount {
  client_id: string;
  loan_balance: number;
  margin_ratio: number;
  portfolio_value: number;
  client_equity: number;
  maintenance_status: 'NORMAL' | 'WARNING' | 'MARGIN_CALL' | 'FORCE_SELL';
  last_margin_call_date: string | null;
  margin_call_count: number;
  created_at: string;
  updated_at: string;
  client?: Client;
}

export interface MarginAlert {
  id: number;
  client_id: string;
  alert_date: string;
  alert_type: string;
  details: Record<string, unknown> | null;
  notification_sent: boolean;
  resolved: boolean;
  resolved_date: string | null;
  resolved_by: string | null;
  created_at: string;
  client?: Client;
}

export interface DailySnapshot {
  client_id: string;
  snapshot_date: string;
  total_portfolio_value: number;
  cash_balance: number;
  loan_balance: number;
  net_equity: number;
  margin_utilization_pct: number | null;
  unrealized_pl: number;
  created_at: string;
  client?: Client;
}

export interface FeeScheduleEntry {
  id: number;
  fee_type: string;
  rate: number;
  min_amount: number | null;
  max_amount: number | null;
  applies_to: string | null;
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
