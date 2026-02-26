-- Import state tracking: baseline guard, deposit dedup, running balance recalc
-- Depends on: 00001_initial_schema.sql (cash_ledger, holdings, import_audit)

-- =============================================================================
-- 1. import_state singleton — tracks baseline and daily processing watermark
-- =============================================================================
CREATE TABLE import_state (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  baseline_date DATE,
  last_processed_date DATE,
  baseline_import_audit_id BIGINT REFERENCES import_audit(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed the singleton row
INSERT INTO import_state (id) VALUES (1);

CREATE TRIGGER tr_import_state_updated
  BEFORE UPDATE ON import_state
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 2. Add import_audit_id to cash_ledger and holdings for traceability
-- =============================================================================
ALTER TABLE cash_ledger ADD COLUMN import_audit_id BIGINT REFERENCES import_audit(id);
ALTER TABLE holdings ADD COLUMN import_audit_id BIGINT REFERENCES import_audit(id);

CREATE INDEX idx_cash_ledger_audit ON cash_ledger(import_audit_id) WHERE import_audit_id IS NOT NULL;
CREATE INDEX idx_holdings_audit ON holdings(import_audit_id) WHERE import_audit_id IS NOT NULL;

-- =============================================================================
-- 3. recalc_running_balance — replays cash_ledger entries by id ASC for a client
-- =============================================================================
CREATE OR REPLACE FUNCTION recalc_running_balance(p_client_id UUID)
RETURNS VOID AS $$
DECLARE
  r RECORD;
  running NUMERIC := 0;
BEGIN
  FOR r IN
    SELECT id, amount
    FROM cash_ledger
    WHERE client_id = p_client_id
    ORDER BY id ASC
  LOOP
    running := running + r.amount;
    UPDATE cash_ledger SET running_balance = running WHERE id = r.id;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 4. RLS for import_state — same pattern as other admin tables
-- =============================================================================
ALTER TABLE import_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY import_state_admin_full ON import_state
  FOR ALL USING (get_user_role() IN ('admin', 'risk_manager', 'operations'));

CREATE POLICY import_state_viewer_read ON import_state
  FOR SELECT USING (get_user_role() = 'viewer');
