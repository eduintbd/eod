-- BSEC Margin Rules 2025 Implementation
-- Migration: margin_config table, security marginability fields, margin account enhancements

-- =============================================================================
-- 1. margin_config — configurable margin parameters (key-value)
-- =============================================================================
CREATE TABLE margin_config (
  id SERIAL PRIMARY KEY,
  parameter_name TEXT UNIQUE NOT NULL,
  parameter_value NUMERIC NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  effective_from DATE DEFAULT CURRENT_DATE,
  effective_to DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER tr_margin_config_updated
  BEFORE UPDATE ON margin_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS: read for all, write for admin
ALTER TABLE margin_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY margin_config_read ON margin_config FOR SELECT USING (TRUE);
CREATE POLICY margin_config_write ON margin_config FOR ALL USING (get_user_role() = 'admin');

-- Seed default parameters
INSERT INTO margin_config (parameter_name, parameter_value, description) VALUES
  ('market_pe_threshold', 20, 'Overall market P/E threshold — when exceeded, margin ratio caps at 1:0.5 (BSEC Section 7(5))'),
  ('market_pe_cap_active', 0, 'Whether market P/E cap is currently in effect (1=yes, 0=no). Admin toggles per BSEC directive.'),
  ('normal_threshold', 0.75, 'Equity/Portfolio ratio for NORMAL status — equity >= 75% of margin financing (Section 9(1))'),
  ('force_sell_threshold', 0.50, 'Equity/Portfolio ratio for FORCE_SELL — equity <= 50% triggers immediate forced sale (Section 9(4))'),
  ('margin_call_deadline_days', 3, 'Business days client has to restore margin after margin call (Section 9(3))'),
  ('single_client_limit_pct', 0.15, 'Max margin to single client as fraction of core capital/net worth (Section 17)'),
  ('single_client_limit_max', 100000000, 'Absolute max margin to single client in BDT — 10 Crore (Section 17)'),
  ('single_security_limit_pct', 0.15, 'Max total margin in single security as fraction of total outstanding (Section 18)'),
  ('core_capital_net_worth', 0, 'Firm core capital / net worth in BDT. Must be set by admin for exposure limits.'),
  ('min_ffmc_mn', 500, 'Minimum free float market cap in millions (mn) for marginability — 50 Crore = 500mn (Section 11(3))'),
  ('max_trailing_pe', 30, 'Maximum trailing P/E for marginability (Section 11(4))'),
  ('sectoral_pe_multiplier', 2, 'Security P/E must be <= this x sectoral median P/E, whichever is lower (Section 11(4))'),
  ('portfolio_tier1_min', 500000, 'Min portfolio value (BDT) for tier 1 margin — 5 lakh (Section 7(6)(a))'),
  ('portfolio_tier1_max', 1000000, 'Max portfolio value (BDT) for tier 1 margin — 10 lakh (Section 7(6)(a))'),
  ('portfolio_tier1_ratio', 0.667, 'Min equity ratio for tier 1 (5-10L portfolio). 1:0.5 means equity covers 66.7% of portfolio.'),
  ('portfolio_tier2_ratio', 0.50, 'Min equity ratio for tier 2 (10L+ portfolio). 1:1 means equity covers 50% of portfolio.');

-- =============================================================================
-- 2. ALTER securities — marginability classification fields
-- =============================================================================
ALTER TABLE securities ADD COLUMN annual_dividend_pct NUMERIC;
ALTER TABLE securities ADD COLUMN marginability_reason TEXT;
ALTER TABLE securities ADD COLUMN marginability_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN securities.annual_dividend_pct IS 'Annual dividend as % of face value. B-category needs >= 5% for marginability.';
COMMENT ON COLUMN securities.marginability_reason IS 'Reason for is_marginable flag — set by classify-marginability function.';
COMMENT ON COLUMN securities.marginability_updated_at IS 'Last time marginability was evaluated.';

-- =============================================================================
-- 3. ALTER margin_accounts — BSEC compliance fields
-- =============================================================================
ALTER TABLE margin_accounts ADD COLUMN margin_call_deadline DATE;
ALTER TABLE margin_accounts ADD COLUMN marginable_portfolio_value NUMERIC DEFAULT 0;
ALTER TABLE margin_accounts ADD COLUMN total_portfolio_value NUMERIC DEFAULT 0;
ALTER TABLE margin_accounts ADD COLUMN applied_ratio TEXT DEFAULT '1:1';

COMMENT ON COLUMN margin_accounts.margin_call_deadline IS '3 business days from margin call date — client must restore by this date (Section 9(3))';
COMMENT ON COLUMN margin_accounts.marginable_portfolio_value IS 'Portfolio value counting only marginable securities (Section 7(4))';
COMMENT ON COLUMN margin_accounts.total_portfolio_value IS 'Portfolio value counting all holdings (for display)';
COMMENT ON COLUMN margin_accounts.applied_ratio IS 'Dynamic equity:margin ratio applied based on portfolio size and market P/E cap';

-- =============================================================================
-- 4. ALTER margin_alerts — deadline tracking
-- =============================================================================
ALTER TABLE margin_alerts ADD COLUMN deadline_date DATE;

COMMENT ON COLUMN margin_alerts.deadline_date IS 'Deadline for margin call resolution — 3 business days from alert date';
