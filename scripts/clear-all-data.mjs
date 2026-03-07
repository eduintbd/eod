import { createClient } from '@supabase/supabase-js';
import { MAIN_URL, MAIN_KEY } from './lib/env.mjs';

const db = createClient(MAIN_URL, MAIN_KEY, { auth: { persistSession: false } });

// Order matters — FK constraints
const tables = [
  'margin_alerts',
  'margin_accounts',
  'daily_snapshots',
  'cash_ledger',
  'holdings',
  'trade_executions',
  'raw_trades',
  'daily_prices',
  'import_audit',
];

console.log('=== CLEARING ALL TRANSACTIONAL DATA ===\n');

for (const t of tables) {
  const { count: before } = await db.from(t).select('*', { count: 'exact', head: true });
  const { error } = await db.from(t).delete().neq('id', '00000000-0000-0000-0000-000000000000'); // delete all
  if (error) {
    // Some tables use integer IDs
    const { error: err2 } = await db.from(t).delete().gte('id', 0);
    if (err2) {
      // Try with gt on created_at
      const { error: err3 } = await db.from(t).delete().gte('created_at', '1970-01-01');
      console.log(`  ${t}: ${before} rows — ${err3 ? 'ERROR: ' + err3.message : 'CLEARED'}`);
    } else {
      console.log(`  ${t}: ${before} rows — CLEARED`);
    }
  } else {
    console.log(`  ${t}: ${before} rows — CLEARED`);
  }
}

// Reset import_state
const { data: isData } = await db.from('import_state').select('id');
if (isData?.length) {
  await db.from('import_state').delete().eq('id', isData[0].id);
  console.log(`  import_state: RESET`);
}

// Clear clients (will be recreated by admin balance import)
const { count: clientCount } = await db.from('clients').select('*', { count: 'exact', head: true });
const { error: clientErr } = await db.from('clients').delete().gte('created_at', '1970-01-01');
console.log(`  clients: ${clientCount} rows — ${clientErr ? 'ERROR: ' + clientErr.message : 'CLEARED'}`);

console.log('\n=== KEPT (config/reference) ===');
for (const t of ['securities', 'fee_schedule', 'margin_config', 'app_users']) {
  const { count } = await db.from(t).select('*', { count: 'exact', head: true });
  console.log(`  ${t}: ${count} rows (kept)`);
}

console.log('\n=== VERIFICATION ===');
for (const t of [...tables, 'import_state', 'clients']) {
  const { count } = await db.from(t).select('*', { count: 'exact', head: true });
  console.log(`  ${t}: ${count}`);
}
