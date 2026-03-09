-- =============================================================================
-- Commission Rate Changes — Audit Table + RPC
-- =============================================================================

-- Audit table for commission rate changes
CREATE TABLE commission_rate_changes (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(client_id),
  old_rate NUMERIC(5,4),
  new_rate NUMERIC(5,4) NOT NULL,
  effective_date DATE NOT NULL,
  reason TEXT,
  changed_by UUID REFERENCES auth.users(id),
  changed_by_email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_commission_changes_client ON commission_rate_changes(client_id);

-- RLS
ALTER TABLE commission_rate_changes ENABLE ROW LEVEL SECURITY;

-- Admin: full access
CREATE POLICY commission_changes_admin_full ON commission_rate_changes
  FOR ALL USING (get_user_role() IN ('admin'));

-- Risk manager, operations, viewer: read-only
CREATE POLICY commission_changes_readonly ON commission_rate_changes
  FOR SELECT USING (get_user_role() IN ('risk_manager', 'operations', 'viewer'));

-- =============================================================================
-- RPC: change_commission_rate
-- Atomically updates clients.commission_rate and inserts audit row.
-- =============================================================================
CREATE OR REPLACE FUNCTION change_commission_rate(
  p_client_id UUID,
  p_new_rate NUMERIC,
  p_effective_date DATE,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_old_rate NUMERIC;
  v_user_id UUID;
  v_user_email TEXT;
BEGIN
  -- Get current user info
  v_user_id := auth.uid();
  SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;

  -- Verify caller is admin
  IF get_user_role() != 'admin' THEN
    RAISE EXCEPTION 'Only admins can change commission rates';
  END IF;

  -- Read current rate
  SELECT commission_rate INTO v_old_rate
  FROM clients
  WHERE client_id = p_client_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client not found: %', p_client_id;
  END IF;

  -- Update client commission rate
  UPDATE clients
  SET commission_rate = p_new_rate,
      updated_at = NOW()
  WHERE client_id = p_client_id;

  -- Insert audit record
  INSERT INTO commission_rate_changes (
    client_id, old_rate, new_rate, effective_date,
    reason, changed_by, changed_by_email
  ) VALUES (
    p_client_id, v_old_rate, p_new_rate, p_effective_date,
    p_reason, v_user_id, v_user_email
  );

  RETURN json_build_object(
    'old_rate', v_old_rate,
    'new_rate', p_new_rate,
    'effective_date', p_effective_date
  );
END;
$$;
