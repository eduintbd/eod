-- Migration: Add amount_payable column to cash_ledger and compute_amount_payable() function
-- amount_payable represents the projected amount an investor owes after accounting for
-- all unprocessed trades (buys and sells) plus brokerage commission.

-- Step 1: Add column
ALTER TABLE public.cash_ledger ADD COLUMN IF NOT EXISTS amount_payable NUMERIC DEFAULT 0;

-- Step 2: Create function to compute and update amount_payable for all clients
CREATE OR REPLACE FUNCTION public.compute_amount_payable()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Reset all amount_payable to 0
  UPDATE public.cash_ledger SET amount_payable = 0 WHERE amount_payable != 0;

  -- Compute and update: for each client, find their latest cash_ledger row,
  -- then calculate projected balance using unprocessed trades
  WITH latest_ledger AS (
    SELECT DISTINCT ON (client_id)
      id, client_id, running_balance
    FROM public.cash_ledger
    ORDER BY client_id, id DESC
  ),
  unprocessed_trades AS (
    SELECT
      rt.client_code,
      COALESCE(SUM(CASE WHEN rt.side = 'B' THEN COALESCE(rt.value, 0) ELSE 0 END), 0) AS buy_total,
      COALESCE(SUM(CASE WHEN rt.side = 'S' THEN COALESCE(rt.value, 0) ELSE 0 END), 0) AS sell_total
    FROM public.raw_trades rt
    WHERE rt.processed = false
      AND rt.action = 'EXEC'
      AND rt.status IN ('PF', 'FILL')
    GROUP BY rt.client_code
  ),
  computed AS (
    SELECT
      ll.id AS ledger_id,
      ll.running_balance,
      COALESCE(ut.buy_total, 0) AS buy_total,
      COALESCE(ut.sell_total, 0) AS sell_total,
      COALESCE(c.commission_rate, 0.003) AS comm_rate,
      ABS(
        ll.running_balance
        - COALESCE(ut.buy_total, 0) - (COALESCE(ut.buy_total, 0) * COALESCE(c.commission_rate, 0.003))
        + COALESCE(ut.sell_total, 0) - (COALESCE(ut.sell_total, 0) * COALESCE(c.commission_rate, 0.003))
      ) AS payable
    FROM latest_ledger ll
    JOIN public.clients c ON c.client_id = ll.client_id
    LEFT JOIN unprocessed_trades ut ON ut.client_code = c.client_code
    WHERE (
      -- Include clients with negative running_balance
      ll.running_balance < 0
      -- OR clients with unprocessed trades whose projected balance is negative
      OR (
        ut.client_code IS NOT NULL
        AND (
          ll.running_balance
          - COALESCE(ut.buy_total, 0) - (COALESCE(ut.buy_total, 0) * COALESCE(c.commission_rate, 0.003))
          + COALESCE(ut.sell_total, 0) - (COALESCE(ut.sell_total, 0) * COALESCE(c.commission_rate, 0.003))
        ) < 0
      )
    )
  )
  UPDATE public.cash_ledger cl
  SET amount_payable = computed.payable
  FROM computed
  WHERE cl.id = computed.ledger_id;
END;
$$;

-- Step 3: Drop and recreate get_negative_balance_clients with new return type
-- (cannot use CREATE OR REPLACE when changing return columns)
DROP FUNCTION IF EXISTS public.get_negative_balance_clients();
CREATE FUNCTION public.get_negative_balance_clients()
RETURNS TABLE (
  client_id UUID,
  running_balance NUMERIC,
  transaction_date DATE,
  entry_type TEXT,
  reference TEXT,
  narration TEXT,
  ledger_id BIGINT,
  amount_payable NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT ON (cl.client_id)
    cl.client_id,
    cl.running_balance,
    cl.transaction_date,
    cl.type AS entry_type,
    cl.reference,
    cl.narration,
    cl.id AS ledger_id,
    COALESCE(cl.amount_payable, 0) AS amount_payable
  FROM public.cash_ledger cl
  WHERE cl.running_balance < 0
     OR cl.amount_payable > 0
  ORDER BY cl.client_id, cl.id DESC;
END;
$$;

-- Step 4: Run initial computation
SELECT public.compute_amount_payable();
