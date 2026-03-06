-- Function to efficiently get clients with negative cash balances
-- Uses DISTINCT ON to get the latest cash_ledger entry per client
CREATE OR REPLACE FUNCTION get_negative_balance_clients()
RETURNS TABLE (
  client_id UUID,
  running_balance NUMERIC,
  transaction_date DATE,
  entry_type TEXT,
  reference TEXT,
  narration TEXT,
  ledger_id BIGINT
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    latest.client_id,
    latest.running_balance,
    latest.transaction_date,
    latest.type AS entry_type,
    latest.reference,
    latest.narration,
    latest.id AS ledger_id
  FROM (
    SELECT DISTINCT ON (cl.client_id)
      cl.client_id,
      cl.running_balance,
      cl.transaction_date,
      cl.type,
      cl.reference,
      cl.narration,
      cl.id
    FROM cash_ledger cl
    ORDER BY cl.client_id, cl.id DESC
  ) latest
  WHERE latest.running_balance < 0;
$$;
