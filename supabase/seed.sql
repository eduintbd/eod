-- Seed data: default fee schedule (as of February 2026)

INSERT INTO fee_schedule (fee_type, rate, min_amount, max_amount, applies_to, effective_from, is_active) VALUES
  ('BROKERAGE_COMMISSION', 0.0030, 0, NULL, 'BOTH', '2026-01-01', TRUE),   -- 0.30%
  ('EXCHANGE_FEE',         0.0003, 0, NULL, 'BOTH', '2026-01-01', TRUE),   -- 0.03% (Laga)
  ('CDBL_FEE',             0.000175, 5, NULL, 'BOTH', '2026-01-01', TRUE),  -- 0.0175%, min BDT 5
  ('AIT',                  0.0005, 0, NULL, 'BOTH', '2026-01-01', TRUE);    -- 0.05%
