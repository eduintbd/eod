import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

// Load .env manually
const envText = readFileSync(new URL('../.env', import.meta.url), 'utf8');
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
}

const sb = createClient(
  process.env.VITE_SUPABASE_URL || 'https://zuupegtizrvbnsliuddu.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const DATE = '2026-01-13';
const KEEP_AUDIT_ID = 29; // latest deposit import — keep this one
const OLD_AUDIT_IDS = [26, 27, 28]; // duplicates to remove

// 1. Show current state
console.log('=== BEFORE CLEANUP ===');
for (const id of [KEEP_AUDIT_ID, ...OLD_AUDIT_IDS]) {
  const { count } = await sb.from('cash_ledger').select('*', { count: 'exact', head: true }).eq('import_audit_id', id);
  console.log(`  Audit ${id}: ${count} cash_ledger entries`);
}
const { count: totalBefore } = await sb.from('cash_ledger').select('*', { count: 'exact', head: true }).eq('transaction_date', DATE);
console.log(`  Total cash_ledger for ${DATE}: ${totalBefore}`);

// 2. Collect affected client_ids before deleting
const affectedClients = new Set();
for (const oldId of OLD_AUDIT_IDS) {
  const { data: entries } = await sb.from('cash_ledger').select('client_id').eq('import_audit_id', oldId);
  if (entries) for (const e of entries) affectedClients.add(e.client_id);
}
console.log(`\nAffected clients: ${affectedClients.size}`);

// 3. Delete cash_ledger entries for old audit IDs
console.log('\n=== DELETING DUPLICATE ENTRIES ===');
for (const oldId of OLD_AUDIT_IDS) {
  const { error, count } = await sb.from('cash_ledger').delete({ count: 'exact' }).eq('import_audit_id', oldId);
  if (error) {
    console.log(`  Audit ${oldId}: ERROR — ${error.message}`);
  } else {
    console.log(`  Audit ${oldId}: deleted ${count} entries`);
  }
}

// 4. Mark old audit records as FAILED (replaced)
for (const oldId of OLD_AUDIT_IDS) {
  const { error } = await sb.from('import_audit').update({
    status: 'FAILED',
    error_details: { replaced_by: KEEP_AUDIT_ID, reason: 'duplicate deposit import cleanup' },
  }).eq('id', oldId);
  if (error) {
    console.log(`  Audit ${oldId} status update ERROR: ${error.message}`);
  } else {
    console.log(`  Audit ${oldId}: marked as FAILED (replaced_by: ${KEEP_AUDIT_ID})`);
  }
}

// 5. Recalculate running balances for affected clients
console.log(`\n=== RECALCULATING BALANCES for ${affectedClients.size} clients ===`);
let recalcOk = 0, recalcFail = 0;
for (const clientId of affectedClients) {
  const { error } = await sb.rpc('recalc_running_balance', { p_client_id: clientId });
  if (error) {
    recalcFail++;
    if (recalcFail <= 3) console.log(`  FAIL ${clientId}: ${error.message}`);
  } else {
    recalcOk++;
  }
}
console.log(`  Recalculated: ${recalcOk} OK, ${recalcFail} failed`);

// 6. Verify after cleanup
console.log('\n=== AFTER CLEANUP ===');
const { count: totalAfter } = await sb.from('cash_ledger').select('*', { count: 'exact', head: true }).eq('transaction_date', DATE);
console.log(`  Total cash_ledger for ${DATE}: ${totalAfter}`);
const { count: keepCount } = await sb.from('cash_ledger').select('*', { count: 'exact', head: true }).eq('import_audit_id', KEEP_AUDIT_ID);
console.log(`  Audit ${KEEP_AUDIT_ID} entries: ${keepCount}`);

// Show audit statuses
const { data: audits } = await sb.from('import_audit').select('id, file_type, status, error_details').eq('data_date', DATE).eq('file_type', 'DEPOSIT_WITHDRAWAL').order('id');
console.log('\n=== DEPOSIT AUDIT RECORDS ===');
for (const a of audits || []) {
  console.log(`  ID:${a.id} | ${a.status} | ${JSON.stringify(a.error_details)}`);
}

// Check cash_ledger counts by type
const types = ['DEPOSIT', 'WITHDRAWAL', 'BUY_TRADE', 'SELL_TRADE', 'OPENING_BALANCE'];
console.log('\n=== CASH LEDGER COUNTS BY TYPE (2026-01-13) ===');
for (const t of types) {
  const { count } = await sb.from('cash_ledger').select('*', { count: 'exact', head: true }).eq('transaction_date', DATE).eq('type', t);
  if (count > 0) console.log(`  ${t}: ${count}`);
}
// Entries with no audit_id (from trade processing)
const { count: noAudit } = await sb.from('cash_ledger').select('*', { count: 'exact', head: true }).eq('transaction_date', DATE).is('import_audit_id', null);
console.log(`  No audit_id (trade processing): ${noAudit}`);
