-- Database function to get trade and cash summary stats
CREATE OR REPLACE FUNCTION get_import_summary()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'dse_buy_count', (SELECT COUNT(*) FROM raw_trades WHERE source='DSE' AND status IN ('FILL','PF') AND side='B' AND quantity>0),
    'dse_buy_value', (SELECT COALESCE(SUM(value),0) FROM raw_trades WHERE source='DSE' AND status IN ('FILL','PF') AND side='B' AND quantity>0),
    'dse_buy_qty',   (SELECT COALESCE(SUM(quantity),0) FROM raw_trades WHERE source='DSE' AND status IN ('FILL','PF') AND side='B' AND quantity>0),
    'dse_sell_count', (SELECT COUNT(*) FROM raw_trades WHERE source='DSE' AND status IN ('FILL','PF') AND side='S' AND quantity>0),
    'dse_sell_value', (SELECT COALESCE(SUM(value),0) FROM raw_trades WHERE source='DSE' AND status IN ('FILL','PF') AND side='S' AND quantity>0),
    'dse_sell_qty',   (SELECT COALESCE(SUM(quantity),0) FROM raw_trades WHERE source='DSE' AND status IN ('FILL','PF') AND side='S' AND quantity>0),
    'cse_buy_count',  (SELECT COUNT(*) FROM raw_trades WHERE source='CSE' AND side='B'),
    'cse_buy_value',  (SELECT COALESCE(SUM(value),0) FROM raw_trades WHERE source='CSE' AND side='B'),
    'cse_buy_qty',    (SELECT COALESCE(SUM(quantity),0) FROM raw_trades WHERE source='CSE' AND side='B'),
    'cse_sell_count',  (SELECT COUNT(*) FROM raw_trades WHERE source='CSE' AND side='S'),
    'cse_sell_value',  (SELECT COALESCE(SUM(value),0) FROM raw_trades WHERE source='CSE' AND side='S'),
    'cse_sell_qty',    (SELECT COALESCE(SUM(quantity),0) FROM raw_trades WHERE source='CSE' AND side='S'),
    'deposit_count',   (SELECT COUNT(*) FROM cash_ledger WHERE type='DEPOSIT'),
    'deposit_total',   (SELECT COALESCE(SUM(amount),0) FROM cash_ledger WHERE type='DEPOSIT'),
    'withdrawal_count',(SELECT COUNT(*) FROM cash_ledger WHERE type='WITHDRAWAL'),
    'withdrawal_total',(SELECT COALESCE(SUM(ABS(amount)),0) FROM cash_ledger WHERE type='WITHDRAWAL'),
    'opening_balance_count', (SELECT COUNT(*) FROM cash_ledger WHERE type='OPENING_BALANCE'),
    'opening_balance_total', (SELECT COALESCE(SUM(amount),0) FROM cash_ledger WHERE type='OPENING_BALANCE'),
    'total_clients',   (SELECT COUNT(*) FROM clients),
    'total_holdings',  (SELECT COUNT(*) FROM holdings),
    'total_securities',(SELECT COUNT(*) FROM securities),
    'trades_processed',(SELECT COUNT(*) FROM trade_executions),
    'trades_unprocessed', (SELECT COUNT(*) FROM raw_trades WHERE processed=false AND status IN ('FILL','PF') AND quantity>0)
  ) INTO result;
  RETURN result;
END;
$$;
