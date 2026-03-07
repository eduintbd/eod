import { createClient } from '@supabase/supabase-js';
import { MAIN_URL, MAIN_KEY } from './lib/env.mjs';

const supabase = createClient(MAIN_URL, MAIN_KEY, { auth: { persistSession: false } });

const round = (v) => Math.round(v * 100) / 100;
const round4 = (v) => Math.round(v * 10000) / 10000;

// Determine snapshot date (latest daily_prices date)
const { data: maxRow } = await supabase.from('daily_prices')
  .select('date').order('date', { ascending: false }).limit(1).single();
const snapshotDate = process.argv[2] || maxRow?.date;
console.log('Snapshot date:', snapshotDate);

// Load margin config
const { data: configRows } = await supabase.from('margin_config').select('key, value');
const cfg = {};
for (const r of configRows || []) cfg[r.key] = r.value;
const normalThreshold = cfg.normal_threshold ?? 0.75;
const forceSellThreshold = cfg.force_sell_threshold ?? 0.5;
const deadlineDays = cfg.margin_call_deadline_days ?? 3;
console.log('Config:', { normalThreshold, forceSellThreshold, deadlineDays });

// Load ALL daily_prices for this date into a map
const { data: allPrices } = await supabase.from('daily_prices')
  .select('isin, close_price').eq('date', snapshotDate);
const priceMap = {};
for (const p of allPrices || []) priceMap[p.isin] = Number(p.close_price);
console.log(`Loaded ${Object.keys(priceMap).length} prices for ${snapshotDate}`);

// Also load fallback prices (latest before snapshot)
const { data: fallbackPrices } = await supabase.from('daily_prices')
  .select('isin, close_price, date').lt('date', snapshotDate).order('date', { ascending: false });
const fallbackMap = {};
for (const p of fallbackPrices || []) {
  if (!fallbackMap[p.isin]) fallbackMap[p.isin] = Number(p.close_price);
}
console.log(`Loaded ${Object.keys(fallbackMap).length} fallback prices`);

// Load security marginability
const { data: securities } = await supabase.from('securities').select('isin, is_marginable');
const marginableSet = new Set();
for (const s of securities || []) {
  if (s.is_marginable) marginableSet.add(s.isin);
}
console.log(`${marginableSet.size} marginable securities`);

// Load ALL holdings with qty > 0
const { data: allHoldings } = await supabase.from('holdings')
  .select('client_id, isin, quantity, average_cost').gt('quantity', 0);
const holdingsByClient = {};
for (const h of allHoldings || []) {
  if (!holdingsByClient[h.client_id]) holdingsByClient[h.client_id] = [];
  holdingsByClient[h.client_id].push(h);
}
console.log(`Loaded ${allHoldings?.length} holdings for ${Object.keys(holdingsByClient).length} clients`);

// Load ALL cash_ledger (latest per client)
const { data: allLedger } = await supabase.from('cash_ledger')
  .select('client_id, running_balance').order('id', { ascending: false });
const cashByClient = {};
for (const l of allLedger || []) {
  if (!cashByClient[l.client_id]) cashByClient[l.client_id] = Number(l.running_balance);
}
console.log(`Loaded cash balances for ${Object.keys(cashByClient).length} clients`);

// Load ALL clients (Margin + Cash) — negative equity can occur in any account type
let allClients = [];
let offset = 0;
while (true) {
  const { data: batch } = await supabase.from('clients')
    .select('client_id, client_code, account_type')
    .order('client_id')
    .range(offset, offset + 999);
  if (!batch || batch.length === 0) break;
  allClients.push(...batch);
  offset += batch.length;
  if (batch.length < 1000) break;
}
const marginCount = allClients.filter(c => c.account_type === 'Margin').length;
const cashCount = allClients.length - marginCount;
console.log(`\nProcessing ${allClients.length} clients (${marginCount} Margin, ${cashCount} Cash/Other)...`);

// Load existing margin_accounts
const { data: existingMargins } = await supabase.from('margin_accounts')
  .select('client_id, maintenance_status, margin_call_count, margin_call_deadline');
const existingMap = {};
for (const m of existingMargins || []) existingMap[m.client_id] = m;

function addBusinessDays(date, days) {
  const d = new Date(date);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 5 && dow !== 6) added++; // Skip Fri/Sat/Sun for BD market
  }
  return d.toISOString().slice(0, 10);
}

const statusCounts = { NORMAL: 0, MARGIN_CALL: 0, FORCE_SELL: 0 };
let alertsGenerated = 0;
const upsertBatch = [];
const alertBatch = [];

for (const client of allClients) {
  const holdings = holdingsByClient[client.client_id] || [];
  const cashBalance = cashByClient[client.client_id] ?? 0;
  const loanBalance = cashBalance < 0 ? Math.abs(cashBalance) : 0;

  let totalPortfolioValue = 0;
  let marginablePortfolioValue = 0;

  for (const h of holdings) {
    const qty = Number(h.quantity);
    const avgCost = Number(h.average_cost);
    const price = priceMap[h.isin] ?? fallbackMap[h.isin] ?? avgCost;
    const val = qty * price;
    totalPortfolioValue += val;
    if (marginableSet.has(h.isin)) marginablePortfolioValue += val;
  }

  const marginableEquity = marginablePortfolioValue - loanBalance;
  const equityRatio = marginablePortfolioValue > 0 ? marginableEquity / marginablePortfolioValue : 1;
  const totalEquity = totalPortfolioValue - loanBalance;

  let status;
  if (equityRatio >= normalThreshold) status = 'NORMAL';
  else if (equityRatio <= forceSellThreshold) status = 'FORCE_SELL';
  else status = 'MARGIN_CALL';

  // Deadline breach
  const existing = existingMap[client.client_id];
  const prevStatus = existing?.maintenance_status ?? null;
  let effectiveStatus = status;
  let deadlineBreached = false;
  if (status === 'MARGIN_CALL' && existing?.margin_call_deadline && existing.margin_call_deadline < snapshotDate) {
    effectiveStatus = 'FORCE_SELL';
    deadlineBreached = true;
  }
  statusCounts[effectiveStatus]++;

  const marginUpsert = {
    client_id: client.client_id,
    loan_balance: round(loanBalance),
    margin_ratio: round4(equityRatio),
    portfolio_value: round(totalPortfolioValue),
    marginable_portfolio_value: round(marginablePortfolioValue),
    total_portfolio_value: round(totalPortfolioValue),
    client_equity: round(totalEquity),
    maintenance_status: effectiveStatus,
  };

  const prevCallCount = existing?.margin_call_count ?? 0;
  if (effectiveStatus === 'MARGIN_CALL' || effectiveStatus === 'FORCE_SELL') {
    if (prevStatus !== effectiveStatus) {
      marginUpsert.last_margin_call_date = snapshotDate;
      marginUpsert.margin_call_count = prevCallCount + 1;
      if (effectiveStatus === 'MARGIN_CALL') {
        marginUpsert.margin_call_deadline = addBusinessDays(snapshotDate, deadlineDays);
      } else {
        marginUpsert.margin_call_deadline = null;
      }
    }
  } else {
    marginUpsert.margin_call_count = 0;
    marginUpsert.margin_call_deadline = null;
  }

  upsertBatch.push(marginUpsert);

  // Alert on status change
  if (prevStatus !== effectiveStatus && (effectiveStatus === 'MARGIN_CALL' || effectiveStatus === 'FORCE_SELL')) {
    alertBatch.push({
      client_id: client.client_id,
      alert_date: snapshotDate,
      alert_type: effectiveStatus === 'FORCE_SELL' ? 'FORCE_SELL_TRIGGERED' : 'MARGIN_CALL',
      deadline_date: effectiveStatus === 'MARGIN_CALL' ? addBusinessDays(snapshotDate, deadlineDays) : null,
      details: {
        equity_ratio: round4(equityRatio),
        marginable_portfolio_value: round(marginablePortfolioValue),
        total_portfolio_value: round(totalPortfolioValue),
        loan_balance: round(loanBalance),
      },
    });
    alertsGenerated++;
  }
}

// Batch upsert margin_accounts
console.log(`\nUpserting ${upsertBatch.length} margin accounts...`);
for (let i = 0; i < upsertBatch.length; i += 200) {
  const batch = upsertBatch.slice(i, i + 200);
  const { error } = await supabase.from('margin_accounts').upsert(batch, { onConflict: 'client_id' });
  if (error) { console.log('UPSERT ERROR at batch', i, ':', error.message); break; }
  process.stdout.write(`  ${Math.min(i + 200, upsertBatch.length)}/${upsertBatch.length}\r`);
}

// Batch insert alerts
if (alertBatch.length > 0) {
  console.log(`\nInserting ${alertBatch.length} alerts...`);
  for (let i = 0; i < alertBatch.length; i += 200) {
    const batch = alertBatch.slice(i, i + 200);
    const { error } = await supabase.from('margin_alerts').insert(batch);
    if (error) console.log('ALERT ERROR:', error.message);
  }
}

console.log('\n=== Results ===');
console.log('Snapshot date:', snapshotDate);
console.log('Clients processed:', allClients.length);
console.log('Status counts:', statusCounts);
console.log('Alerts generated:', alertsGenerated);

// Verify
const { count: maCount } = await supabase.from('margin_accounts').select('*', { count: 'exact', head: true });
console.log('Total margin_accounts now:', maCount);
