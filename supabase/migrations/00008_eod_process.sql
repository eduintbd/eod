-- EOD Process: eod_runs tracking table + preflight function + RLS
-- Depends on: 00006_import_state.sql (import_state table)

-- =============================================================================
-- 1. eod_runs — tracks each End-of-Day run
-- =============================================================================
CREATE TABLE eod_runs (
  id BIGSERIAL PRIMARY KEY,
  eod_date DATE NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  total_clients INT DEFAULT 0,
  trades_for_date INT DEFAULT 0,
  unprocessed_trades INT DEFAULT 0,
  deposits_for_date INT DEFAULT 0,
  prices_available BOOLEAN DEFAULT FALSE,
  snapshots_created INT DEFAULT 0,
  margin_alerts_generated INT DEFAULT 0,
  clients_with_negative_balance INT DEFAULT 0,
  total_portfolio_value NUMERIC DEFAULT 0,
  total_cash_balance NUMERIC DEFAULT 0,
  total_loan_balance NUMERIC DEFAULT 0,
  error_details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_eod_runs_date ON eod_runs(eod_date DESC);

-- =============================================================================
-- 2. get_eod_preflight(p_date) — returns JSON with pre-flight checks
-- =============================================================================
CREATE OR REPLACE FUNCTION get_eod_preflight(p_date DATE)
RETURNS JSON AS $$
DECLARE
  v_total_clients INT;
  v_trades_for_date INT;
  v_unprocessed_trades INT;
  v_deposits_for_date INT;
  v_prices_available BOOLEAN;
  v_already_run BOOLEAN;
  v_currently_running BOOLEAN;
  v_last_eod_date DATE;
BEGIN
  -- Total active clients
  SELECT COUNT(*) INTO v_total_clients
  FROM clients WHERE status = 'active';

  -- Trades for this date (processed)
  SELECT COUNT(*) INTO v_trades_for_date
  FROM trade_executions WHERE trade_date = p_date;

  -- Unprocessed raw_trades for this date
  SELECT COUNT(*) INTO v_unprocessed_trades
  FROM raw_trades
  WHERE trade_date::date = p_date
    AND processed = false
    AND status IN ('FILL', 'PF')
    AND (quantity IS NOT NULL AND quantity > 0);

  -- Deposits for this date
  SELECT COUNT(*) INTO v_deposits_for_date
  FROM cash_ledger
  WHERE transaction_date = p_date
    AND type IN ('DEPOSIT', 'WITHDRAWAL');

  -- Prices available for this date
  SELECT EXISTS(
    SELECT 1 FROM daily_prices WHERE date = p_date LIMIT 1
  ) INTO v_prices_available;

  -- Already completed for this date
  SELECT EXISTS(
    SELECT 1 FROM eod_runs WHERE eod_date = p_date AND status = 'COMPLETED'
  ) INTO v_already_run;

  -- Currently running
  SELECT EXISTS(
    SELECT 1 FROM eod_runs WHERE eod_date = p_date AND status = 'RUNNING'
  ) INTO v_currently_running;

  -- Last completed EOD date
  SELECT eod_date INTO v_last_eod_date
  FROM eod_runs
  WHERE status = 'COMPLETED'
  ORDER BY eod_date DESC
  LIMIT 1;

  RETURN json_build_object(
    'total_clients', v_total_clients,
    'trades_for_date', v_trades_for_date,
    'unprocessed_trades', v_unprocessed_trades,
    'deposits_for_date', v_deposits_for_date,
    'prices_available', v_prices_available,
    'already_run', v_already_run,
    'currently_running', v_currently_running,
    'last_eod_date', v_last_eod_date
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- 3. RLS for eod_runs
-- =============================================================================
ALTER TABLE eod_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY eod_runs_admin_full ON eod_runs
  FOR ALL USING (get_user_role() IN ('admin', 'risk_manager', 'operations'));

CREATE POLICY eod_runs_viewer_read ON eod_runs
  FOR SELECT USING (get_user_role() = 'viewer');
