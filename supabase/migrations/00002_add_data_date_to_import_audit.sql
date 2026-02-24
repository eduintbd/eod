-- Add data_date column to import_audit to track which date the imported data represents
ALTER TABLE import_audit ADD COLUMN data_date DATE;

COMMENT ON COLUMN import_audit.data_date IS 'The business date this import data represents (e.g. balance as-of date, trade date)';
