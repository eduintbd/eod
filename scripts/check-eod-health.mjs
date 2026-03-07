/**
 * EOD Health Check — verify the entire data pipeline works.
 * Checks: imports, trades, holdings, cash, margins, alerts, prices, snapshots
 */
import { createClient } from '@supabase/supabase-js';
import { MAIN_URL, MAIN_KEY } from './lib/env.mjs';

const db = createClient(MAIN_URL, MAIN_KEY);

const issues = [];

console.log('=== EOD HEALTH CHECK ===\n');

// 1. Table row counts
console.log('--- TABLE COUNTS ---');
const tables = [
  'clients', 'securities', 'raw_trades', 'trade_executions',
  'holdings', 'cash_ledger', 'margin_accounts', 'margin_alerts',
  'daily_prices', 'daily_snapshots', 'fee_schedule', 'import_audit',
  'import_state', 'app_users', 'margin_config',
  'courses', 'modules', 'lessons', 'enrollments', 'certificates'
];

for (const t of tables) {
  const { count, error } = await db.from(t).select('*', { count: 'exact', head: true });
  const status = error ? `ERROR: ${error.message}` : count;
  console.log(`  ${t}: ${status}`);
  if (count === 0 && ['trade_executions', 'holdings', 'daily_snapshots'].includes(t)) {
    issues.push(`${t} is empty — trades may not have been processed`);
  }
}

// 2. Import audit — latest imports
console.log('\n--- LATEST IMPORTS ---');
const { data: audits } = await db.from('import_audit').select('*').order('created_at', { ascending: false }).limit(5);
for (const a of audits || []) {
  const errs = a.rejected_rows > 0 ? ` (${a.rejected_rows} rejected)` : '';
  console.log(`  ${a.file_type} | ${a.file_name} | ${a.status} | ${a.total_rows} rows, ${a.processed_rows} processed${errs} | ${a.created_at}`);
}

// 3. Raw trades — processed vs unprocessed
console.log('\n--- RAW TRADES ---');
const { data: tradeStats } = await db.rpc('get_import_summary');
if (tradeStats) {
  console.log('  Import summary:', JSON.stringify(tradeStats, null, 2));
}

const { count: totalTrades } = await db.from('raw_trades').select('*', { count: 'exact', head: true });
const { count: processedTrades } = await db.from('raw_trades').select('*', { count: 'exact', head: true }).eq('processed', true);
const { count: unprocessedTrades } = await db.from('raw_trades').select('*', { count: 'exact', head: true }).eq('processed', false);
const { count: errorTrades } = await db.from('raw_trades').select('*', { count: 'exact', head: true }).not('error_message', 'is', null);
console.log(`  Total: ${totalTrades} | Processed: ${processedTrades} | Unprocessed: ${unprocessedTrades} | With errors: ${errorTrades}`);
if (unprocessedTrades > 0) {
  // Check unprocessed by status
  const { data: unproc } = await db.from('raw_trades').select('status, action, side').eq('processed', false).limit(1000);
  const actionCounts = {};
  const statusCounts = {};
  for (const t of unproc || []) {
    actionCounts[t.action] = (actionCounts[t.action] || 0) + 1;
    statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
  }
  console.log(`  Unprocessed by action:`, JSON.stringify(actionCounts));
  console.log(`  Unprocessed by status:`, JSON.stringify(statusCounts));
}

// 4. Holdings check
console.log('\n--- HOLDINGS ---');
const { count: holdingsCount } = await db.from('holdings').select('*', { count: 'exact', head: true });
console.log(`  Total holdings: ${holdingsCount}`);
if (holdingsCount > 0) {
  const { data: negHoldings } = await db.from('holdings').select('client_id, isin, quantity').lt('quantity', 0).limit(5);
  if (negHoldings && negHoldings.length > 0) {
    issues.push(`${negHoldings.length}+ holdings with NEGATIVE quantity`);
    console.log(`  WARNING: Negative holdings found:`, negHoldings);
  }
  const { data: zeroHoldings, count: zeroCount } = await db.from('holdings').select('*', { count: 'exact', head: true }).eq('quantity', 0);
  if (zeroCount > 0) console.log(`  Zero-quantity holdings: ${zeroCount}`);
}

// 5. Cash ledger
console.log('\n--- CASH LEDGER ---');
const { count: ledgerCount } = await db.from('cash_ledger').select('*', { count: 'exact', head: true });
console.log(`  Total entries: ${ledgerCount}`);
const { data: negBalance } = await db.rpc('get_negative_balance_clients');
console.log(`  Clients with negative balance/payable: ${negBalance ? negBalance.length : 'N/A'}`);

// 6. Daily prices
console.log('\n--- DAILY PRICES ---');
const { count: priceCount } = await db.from('daily_prices').select('*', { count: 'exact', head: true });
const { data: latestPrice } = await db.from('daily_prices').select('date').order('date', { ascending: false }).limit(1);
console.log(`  Total: ${priceCount} | Latest date: ${latestPrice && latestPrice[0] ? latestPrice[0].date : 'NONE'}`);
if (!latestPrice || latestPrice.length === 0) {
  issues.push('No daily prices — sync-market-data may not have been run');
}

// 7. Securities coverage
console.log('\n--- SECURITIES ---');
const { data: secs } = await db.from('securities').select('category, board, trailing_pe, free_float_market_cap, is_marginable, last_close_price');
let noPrice = 0, marginable = 0;
for (const s of secs || []) {
  if (s.last_close_price === null) noPrice++;
  if (s.is_marginable) marginable++;
}
console.log(`  Total: ${secs.length} | Marginable: ${marginable} | No close price: ${noPrice}`);

// 8. Margin accounts
console.log('\n--- MARGIN ACCOUNTS ---');
const { count: maCount } = await db.from('margin_accounts').select('*', { count: 'exact', head: true });
console.log(`  Total: ${maCount}`);
if (maCount > 0) {
  const { data: maStats } = await db.from('margin_accounts').select('status');
  const statuses = {};
  for (const m of maStats || []) statuses[m.status] = (statuses[m.status] || 0) + 1;
  console.log(`  By status:`, JSON.stringify(statuses));
}

// 9. Fee schedule
console.log('\n--- FEE SCHEDULE ---');
const { data: fees } = await db.from('fee_schedule').select('fee_type, rate, is_active');
for (const f of fees || []) {
  console.log(`  ${f.fee_type}: ${f.rate} (${f.is_active ? 'active' : 'INACTIVE'})`);
  if (!f.is_active) issues.push(`Fee ${f.fee_type} is inactive`);
}

// 10. Edge function availability (try invoke with dry data)
console.log('\n--- EDGE FUNCTIONS ---');
const funcs = ['process-trades', 'calculate-margins', 'sync-market-data', 'classify-marginability'];
for (const fn of funcs) {
  try {
    const { error } = await db.functions.invoke(fn, { body: { dry_run: true, test: true } });
    console.log(`  ${fn}: ${error ? 'ERROR - ' + error.message : 'reachable'}`);
  } catch (e) {
    console.log(`  ${fn}: UNREACHABLE - ${e.message}`);
  }
}

// 11. Import state
console.log('\n--- IMPORT STATE ---');
const { data: importState } = await db.from('import_state').select('*').limit(1).single();
if (importState) {
  console.log(`  baseline_imported: ${importState.baseline_imported}`);
  console.log(`  last_trade_date: ${importState.last_trade_date}`);
  console.log(`  last_deposit_date: ${importState.last_deposit_date}`);
} else {
  issues.push('No import_state record — import guard may not work');
}

// Summary
console.log('\n=== ISSUES FOUND ===');
if (issues.length === 0) {
  console.log('  No critical issues detected!');
} else {
  for (const i of issues) console.log(`  ⚠ ${i}`);
}
