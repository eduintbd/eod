-- Add DEADLINE_BREACH and EXPOSURE_BREACH alert types to margin_alerts
-- Required for: margin call deadline enforcement, single client exposure limit

ALTER TABLE margin_alerts DROP CONSTRAINT margin_alerts_alert_type_check;
ALTER TABLE margin_alerts ADD CONSTRAINT margin_alerts_alert_type_check
  CHECK (alert_type IN (
    'MARGIN_CALL', 'FORCE_SELL_TRIGGERED', 'CONCENTRATION_BREACH',
    'CATEGORY_CHANGE', 'DEADLINE_BREACH', 'EXPOSURE_BREACH'
  ));
