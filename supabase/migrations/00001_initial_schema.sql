-- UCB Stock CRM & Risk Management Platform - Initial Schema
-- Phase 1: Core Data Integration

-- Use gen_random_uuid() which is built-in to PostgreSQL 13+

-- =============================================================================
-- Helper: auto-update updated_at timestamp
-- =============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 1. app_users - role mapping for Supabase Auth users
-- =============================================================================
CREATE TABLE app_users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin', 'risk_manager', 'rm', 'operations', 'viewer')),
  assigned_client_ids UUID[] DEFAULT '{}',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER tr_app_users_updated
  BEFORE UPDATE ON app_users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 2. clients
-- =============================================================================
CREATE TABLE clients (
  client_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bo_id TEXT UNIQUE,
  client_code TEXT UNIQUE,
  name TEXT,
  category TEXT CHECK (category IN ('retail', 'institution', 'foreign')),
  income_status TEXT CHECK (income_status IN ('employed', 'self_employed', 'student', 'homemaker', 'retired', NULL)),
  is_margin_eligible BOOLEAN DEFAULT FALSE,
  margin_eligibility_date DATE,
  rm_id UUID REFERENCES app_users(id),
  phone TEXT,
  email TEXT,
  address TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed', 'pending_review')),
  kyc_completed BOOLEAN DEFAULT FALSE,
  account_type TEXT CHECK (account_type IN ('Cash', 'Margin', NULL)),
  commission_rate NUMERIC(5,4),
  department TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_clients_bo_id ON clients(bo_id);
CREATE INDEX idx_clients_client_code ON clients(client_code);
CREATE INDEX idx_clients_rm_id ON clients(rm_id);
CREATE INDEX idx_clients_status ON clients(status);

CREATE TRIGGER tr_clients_updated
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 3. securities
-- =============================================================================
CREATE TABLE securities (
  isin TEXT PRIMARY KEY,
  security_code TEXT UNIQUE,
  company_name TEXT,
  asset_class TEXT CHECK (asset_class IN ('EQ', 'MF', 'BOND', 'GOVT')),
  category TEXT CHECK (category IN ('A', 'B', 'Z', 'N', 'G', 'S')),
  board TEXT CHECK (board IN ('PUBLIC', 'BLOCK', 'SPUBLIC', 'SME', 'ATB')),
  lot_size INT DEFAULT 1,
  face_value NUMERIC,
  sector TEXT,
  free_float_market_cap NUMERIC,
  trailing_pe NUMERIC,
  last_close_price NUMERIC,
  is_marginable BOOLEAN DEFAULT FALSE,
  margin_rate NUMERIC,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_securities_code ON securities(security_code);
CREATE INDEX idx_securities_category ON securities(category);

CREATE TRIGGER tr_securities_updated
  BEFORE UPDATE ON securities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 4. raw_trades (staging table)
-- =============================================================================
CREATE TABLE raw_trades (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('DSE', 'CSE')),
  file_name TEXT,
  action TEXT,
  status TEXT,
  order_id TEXT,
  ref_order_id TEXT,
  side TEXT CHECK (side IN ('B', 'S')),
  bo_id TEXT,
  client_code TEXT,
  isin TEXT,
  security_code TEXT,
  board TEXT,
  trade_date DATE,
  trade_time TIME,
  quantity INT,
  price NUMERIC,
  value NUMERIC,
  exec_id TEXT,
  session TEXT,
  fill_type TEXT,
  category TEXT,
  asset_class TEXT,
  compulsory_spot BOOLEAN DEFAULT FALSE,
  trader_dealer_id TEXT,
  owner_dealer_id TEXT,
  raw_data JSONB,
  processed BOOLEAN DEFAULT FALSE,
  error_message TEXT,
  import_audit_id BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_raw_trades_processed ON raw_trades(processed) WHERE processed = FALSE;
CREATE INDEX idx_raw_trades_exec_id ON raw_trades(exec_id);
CREATE INDEX idx_raw_trades_status ON raw_trades(status);
CREATE INDEX idx_raw_trades_import ON raw_trades(import_audit_id);

-- =============================================================================
-- 5. trade_executions
-- =============================================================================
CREATE TABLE trade_executions (
  exec_id TEXT PRIMARY KEY,
  order_id TEXT,
  client_id UUID NOT NULL REFERENCES clients(client_id),
  isin TEXT NOT NULL REFERENCES securities(isin),
  exchange TEXT NOT NULL CHECK (exchange IN ('DSE', 'CSE')),
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  quantity INT NOT NULL,
  price NUMERIC NOT NULL,
  value NUMERIC NOT NULL,
  trade_date DATE NOT NULL,
  trade_time TIME,
  settlement_date DATE,
  session TEXT,
  fill_type TEXT,
  category TEXT,
  board TEXT,
  commission NUMERIC DEFAULT 0,
  exchange_fee NUMERIC DEFAULT 0,
  cdbl_fee NUMERIC DEFAULT 0,
  ait NUMERIC DEFAULT 0,
  net_value NUMERIC NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_trade_exec_client ON trade_executions(client_id);
CREATE INDEX idx_trade_exec_isin ON trade_executions(isin);
CREATE INDEX idx_trade_exec_date ON trade_executions(trade_date);
CREATE INDEX idx_trade_exec_client_date ON trade_executions(client_id, trade_date);

-- =============================================================================
-- 6. holdings
-- =============================================================================
CREATE TABLE holdings (
  client_id UUID NOT NULL REFERENCES clients(client_id),
  isin TEXT NOT NULL REFERENCES securities(isin),
  quantity INT DEFAULT 0,
  average_cost NUMERIC DEFAULT 0,
  total_invested NUMERIC DEFAULT 0,
  realized_pl NUMERIC DEFAULT 0,
  as_of_date DATE DEFAULT CURRENT_DATE,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (client_id, isin)
);

CREATE INDEX idx_holdings_client ON holdings(client_id);
CREATE INDEX idx_holdings_isin ON holdings(isin);

CREATE TRIGGER tr_holdings_updated
  BEFORE UPDATE ON holdings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 7. cash_ledger (append-only ledger model)
-- =============================================================================
CREATE TABLE cash_ledger (
  id BIGSERIAL PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(client_id),
  transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
  value_date DATE,
  amount NUMERIC NOT NULL,
  running_balance NUMERIC NOT NULL,
  type TEXT NOT NULL CHECK (type IN (
    'DEPOSIT', 'WITHDRAWAL', 'BUY_TRADE', 'SELL_TRADE',
    'COMMISSION', 'TAX', 'DIVIDEND', 'IPO_ALLOTMENT',
    'INTEREST_CHARGE', 'OPENING_BALANCE'
  )),
  reference TEXT,
  narration TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_cash_ledger_client ON cash_ledger(client_id);
CREATE INDEX idx_cash_ledger_client_date ON cash_ledger(client_id, transaction_date);
CREATE INDEX idx_cash_ledger_value_date ON cash_ledger(value_date);

-- =============================================================================
-- 8. margin_accounts (Phase 2, table created now)
-- =============================================================================
CREATE TABLE margin_accounts (
  client_id UUID PRIMARY KEY REFERENCES clients(client_id),
  loan_balance NUMERIC DEFAULT 0,
  margin_ratio NUMERIC,
  portfolio_value NUMERIC DEFAULT 0,
  client_equity NUMERIC DEFAULT 0,
  maintenance_status TEXT DEFAULT 'NORMAL' CHECK (maintenance_status IN ('NORMAL', 'WARNING', 'MARGIN_CALL', 'FORCE_SELL')),
  last_margin_call_date DATE,
  margin_call_count INT DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER tr_margin_accounts_updated
  BEFORE UPDATE ON margin_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 9. margin_alerts (Phase 2, table created now)
-- =============================================================================
CREATE TABLE margin_alerts (
  id BIGSERIAL PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(client_id),
  alert_date DATE NOT NULL DEFAULT CURRENT_DATE,
  alert_type TEXT NOT NULL CHECK (alert_type IN ('MARGIN_CALL', 'FORCE_SELL_TRIGGERED', 'CONCENTRATION_BREACH', 'CATEGORY_CHANGE')),
  details JSONB,
  notification_sent BOOLEAN DEFAULT FALSE,
  notification_channels TEXT[] DEFAULT '{}',
  resolved BOOLEAN DEFAULT FALSE,
  resolved_date DATE,
  resolved_by UUID REFERENCES app_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_margin_alerts_client ON margin_alerts(client_id);
CREATE INDEX idx_margin_alerts_unresolved ON margin_alerts(resolved) WHERE resolved = FALSE;

-- =============================================================================
-- 10. daily_prices
-- =============================================================================
CREATE TABLE daily_prices (
  isin TEXT NOT NULL REFERENCES securities(isin),
  date DATE NOT NULL,
  open_price NUMERIC,
  high_price NUMERIC,
  low_price NUMERIC,
  close_price NUMERIC,
  volume BIGINT,
  value NUMERIC,
  num_trades INT,
  source TEXT CHECK (source IN ('DSE', 'CSE')),
  PRIMARY KEY (isin, date)
);

-- =============================================================================
-- 11. daily_snapshots
-- =============================================================================
CREATE TABLE daily_snapshots (
  client_id UUID NOT NULL REFERENCES clients(client_id),
  snapshot_date DATE NOT NULL,
  total_portfolio_value NUMERIC,
  cash_balance NUMERIC,
  loan_balance NUMERIC,
  net_equity NUMERIC,
  margin_utilization_pct NUMERIC,
  unrealized_pl NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (client_id, snapshot_date)
);

-- =============================================================================
-- 12. fee_schedule (configurable)
-- =============================================================================
CREATE TABLE fee_schedule (
  id SERIAL PRIMARY KEY,
  fee_type TEXT NOT NULL CHECK (fee_type IN ('BROKERAGE_COMMISSION', 'EXCHANGE_FEE', 'CDBL_FEE', 'AIT', 'LAGA')),
  rate NUMERIC NOT NULL,
  min_amount NUMERIC DEFAULT 0,
  max_amount NUMERIC,
  applies_to TEXT DEFAULT 'BOTH' CHECK (applies_to IN ('BUY', 'SELL', 'BOTH')),
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER tr_fee_schedule_updated
  BEFORE UPDATE ON fee_schedule
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 13. import_audit
-- =============================================================================
CREATE TABLE import_audit (
  id BIGSERIAL PRIMARY KEY,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL CHECK (file_type IN ('ADMIN_BALANCE', 'DSE_TRADE', 'CSE_TRADE', 'DEPOSIT_WITHDRAWAL', 'PRICE_DATA')),
  import_date TIMESTAMPTZ DEFAULT NOW(),
  total_rows INT DEFAULT 0,
  processed_rows INT DEFAULT 0,
  rejected_rows INT DEFAULT 0,
  error_details JSONB,
  status TEXT DEFAULT 'PROCESSING' CHECK (status IN ('PROCESSING', 'SUCCESS', 'PARTIAL', 'FAILED')),
  imported_by UUID REFERENCES app_users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- Row Level Security Policies
-- =============================================================================

-- Helper function to get current user's role
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT AS $$
  SELECT role FROM app_users WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper function to check if user is admin or risk_manager
CREATE OR REPLACE FUNCTION is_admin_or_risk()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM app_users
    WHERE id = auth.uid() AND role IN ('admin', 'risk_manager')
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper function to get assigned client IDs for RM
CREATE OR REPLACE FUNCTION get_assigned_clients()
RETURNS UUID[] AS $$
  SELECT COALESCE(assigned_client_ids, '{}')
  FROM app_users WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Enable RLS on key tables
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE holdings ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE margin_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE margin_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_audit ENABLE ROW LEVEL SECURITY;

-- Clients: admin/risk/ops see all, RM sees assigned only
CREATE POLICY clients_admin_full ON clients
  FOR ALL USING (get_user_role() IN ('admin', 'risk_manager', 'operations'));

CREATE POLICY clients_rm_read ON clients
  FOR SELECT USING (
    get_user_role() = 'rm' AND client_id = ANY(get_assigned_clients())
  );

CREATE POLICY clients_viewer_read ON clients
  FOR SELECT USING (get_user_role() = 'viewer');

-- Holdings: same pattern as clients
CREATE POLICY holdings_admin_full ON holdings
  FOR ALL USING (get_user_role() IN ('admin', 'risk_manager', 'operations'));

CREATE POLICY holdings_rm_read ON holdings
  FOR SELECT USING (
    get_user_role() = 'rm' AND client_id = ANY(get_assigned_clients())
  );

CREATE POLICY holdings_viewer_read ON holdings
  FOR SELECT USING (get_user_role() = 'viewer');

-- Cash ledger: same pattern
CREATE POLICY cash_ledger_admin_full ON cash_ledger
  FOR ALL USING (get_user_role() IN ('admin', 'risk_manager', 'operations'));

CREATE POLICY cash_ledger_rm_read ON cash_ledger
  FOR SELECT USING (
    get_user_role() = 'rm' AND client_id = ANY(get_assigned_clients())
  );

CREATE POLICY cash_ledger_viewer_read ON cash_ledger
  FOR SELECT USING (get_user_role() = 'viewer');

-- Trade executions: same pattern
CREATE POLICY trade_exec_admin_full ON trade_executions
  FOR ALL USING (get_user_role() IN ('admin', 'risk_manager', 'operations'));

CREATE POLICY trade_exec_rm_read ON trade_executions
  FOR SELECT USING (
    get_user_role() = 'rm' AND client_id = ANY(get_assigned_clients())
  );

CREATE POLICY trade_exec_viewer_read ON trade_executions
  FOR SELECT USING (get_user_role() = 'viewer');

-- Raw trades & import audit: admin/operations full access
CREATE POLICY raw_trades_admin_ops ON raw_trades
  FOR ALL USING (get_user_role() IN ('admin', 'operations'));

CREATE POLICY import_audit_admin_ops ON import_audit
  FOR ALL USING (get_user_role() IN ('admin', 'operations'));

CREATE POLICY import_audit_viewer ON import_audit
  FOR SELECT USING (get_user_role() IN ('viewer', 'risk_manager', 'rm'));

-- Margin tables: admin/risk full, others read
CREATE POLICY margin_accounts_admin ON margin_accounts
  FOR ALL USING (get_user_role() IN ('admin', 'risk_manager'));

CREATE POLICY margin_accounts_read ON margin_accounts
  FOR SELECT USING (get_user_role() IN ('operations', 'viewer'));

CREATE POLICY margin_alerts_admin ON margin_alerts
  FOR ALL USING (get_user_role() IN ('admin', 'risk_manager'));

CREATE POLICY margin_alerts_read ON margin_alerts
  FOR SELECT USING (get_user_role() IN ('operations', 'viewer'));

-- Securities, daily_prices, fee_schedule, daily_snapshots: public read, admin write
ALTER TABLE securities ENABLE ROW LEVEL SECURITY;
CREATE POLICY securities_read ON securities FOR SELECT USING (TRUE);
CREATE POLICY securities_write ON securities FOR ALL USING (get_user_role() = 'admin');

ALTER TABLE daily_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY daily_prices_read ON daily_prices FOR SELECT USING (TRUE);
CREATE POLICY daily_prices_write ON daily_prices FOR ALL USING (get_user_role() IN ('admin', 'operations'));

ALTER TABLE fee_schedule ENABLE ROW LEVEL SECURITY;
CREATE POLICY fee_schedule_read ON fee_schedule FOR SELECT USING (TRUE);
CREATE POLICY fee_schedule_write ON fee_schedule FOR ALL USING (get_user_role() = 'admin');

ALTER TABLE daily_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY daily_snapshots_read ON daily_snapshots FOR SELECT USING (TRUE);
CREATE POLICY daily_snapshots_write ON daily_snapshots FOR ALL USING (get_user_role() IN ('admin', 'operations'));

ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_users_self ON app_users FOR SELECT USING (id = auth.uid());
CREATE POLICY app_users_admin ON app_users FOR ALL USING (get_user_role() = 'admin');
