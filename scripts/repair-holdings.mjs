#!/usr/bin/env node
/**
 * Repair holdings and cash_ledger for all clients.
 *
 * Root cause: process-trades-local.mjs ran trades in parallel (CONCURRENCY=10),
 * causing race conditions on holdings upserts and cash_ledger running_balance.
 *
 * This script:
 * 1. Reads the admin balance CSV to get baseline holdings
 * 2. Replays all trade_executions sequentially per client+isin
 * 3. Updates holdings with correct values
 * 4. Calls recalc_running_balance() to fix the cash_ledger chain
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const SUPABASE_URL = 'https://zuupegtizrvbnsliuddu.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp1dXBlZ3RpenJ2Ym5zbGl1ZGR1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTg3ODE1NCwiZXhwIjoyMDg3NDU0MTU0fQ.fE4D9Y0mFGzY6NT2aqnA9MLQJqHVQRB5VGo6II0zKx0';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

// ---------------------------------------------------------------------------
// 1. Parse the admin balance CSV (baseline)
// ---------------------------------------------------------------------------
function parseFormattedNumber(s) {
  if (!s || s.trim() === '' || s.trim() === '#N/A' || s.trim() === '-') return 0;
  let cleaned = s.trim();
  const isNeg = cleaned.includes('(') && cleaned.includes(')');
  cleaned = cleaned.replace(/[()]/g, '').replace(/,/g, '').trim();
  const num = parseFloat(cleaned);
  if (isNaN(num)) return 0;
  return isNeg ? -num : num;
}

function parseAdminBalanceCSV(filePath) {
  const raw = readFileSync(filePath, 'utf-8');
  const lines = raw.split('\n').filter(l => l.trim());
  const header = lines[0].split(',');

  // Find column indices (handle possible whitespace in headers)
  const idx = (name) => header.findIndex(h => h.trim().toLowerCase().replace(/\s+/g, '') === name.toLowerCase().replace(/\s+/g, ''));
  const iCode = idx('InvestorCode');
  const iBoid = idx('BOID');
  const iInstr = idx('Instrument');
  const iQty = idx('TotalStock');
  const iAvg = idx('AvgCost');
  const iCost = idx('TotalCost');

  if (iCode < 0 || iInstr < 0 || iQty < 0) {
    console.error('Cannot find required columns. Header:', header);
    process.exit(1);
  }

  // Parse CSV rows (handle quoted fields with commas)
  function parseCSVLine(line) {
    const fields = [];
    let current = '';
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === ',' && !inQuotes) { fields.push(current); current = ''; continue; }
      current += ch;
    }
    fields.push(current);
    return fields;
  }

  const holdings = new Map(); // key: "client_code|security_code"
  const clients = new Map();  // client_code -> bo_id

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    const clientCode = (fields[iCode] || '').trim();
    const boId = (fields[iBoid] || '').trim();
    const instrument = (fields[iInstr] || '').trim();
    const qty = parseFormattedNumber(fields[iQty]);
    const avgCost = parseFormattedNumber(fields[iAvg]);
    const totalCost = parseFormattedNumber(fields[iCost]);

    if (!clientCode || !instrument || qty <= 0) continue;

    clients.set(clientCode, boId);
    holdings.set(`${clientCode}|${instrument}`, {
      client_code: clientCode,
      security_code: instrument,
      quantity: qty,
      average_cost: avgCost,
      total_cost: totalCost,
    });
  }

  console.log(`Parsed ${holdings.size} baseline holdings for ${clients.size} clients`);
  return { holdings, clients };
}

// ---------------------------------------------------------------------------
// 2. Build lookup maps from DB
// ---------------------------------------------------------------------------
async function buildMaps() {
  // client_code -> client_id
  const clientMap = new Map();
  let offset = 0;
  while (true) {
    const { data } = await supabase.from('clients').select('client_id, client_code')
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    for (const c of data) clientMap.set(c.client_code, c.client_id);
    offset += data.length;
  }
  console.log(`Loaded ${clientMap.size} clients from DB`);

  // security_code -> isin
  const secMap = new Map();
  offset = 0;
  while (true) {
    const { data } = await supabase.from('securities').select('isin, security_code')
      .range(offset, offset + 999);
    if (!data || data.length === 0) break;
    for (const s of data) if (s.security_code) secMap.set(s.security_code, s.isin);
    offset += data.length;
  }
  console.log(`Loaded ${secMap.size} securities from DB`);

  return { clientMap, secMap };
}

// ---------------------------------------------------------------------------
// 3. Fetch all trade_executions, grouped by client_id+isin
// ---------------------------------------------------------------------------
async function fetchAllTrades() {
  const trades = new Map(); // key: "client_id|isin" -> sorted array of trades
  let offset = 0;
  while (true) {
    const { data, error } = await supabase.from('trade_executions')
      .select('client_id, isin, side, quantity, price, net_value, trade_date, exec_id')
      .order('trade_date', { ascending: true })
      .order('exec_id', { ascending: true })
      .range(offset, offset + 999);
    if (error) { console.error('Fetch trades error:', error.message); break; }
    if (!data || data.length === 0) break;
    for (const t of data) {
      const key = `${t.client_id}|${t.isin}`;
      if (!trades.has(key)) trades.set(key, []);
      trades.get(key).push(t);
    }
    offset += data.length;
    if (offset % 5000 === 0) process.stdout.write(`  fetched ${offset} trades...\r`);
  }
  console.log(`Fetched trades for ${trades.size} client+isin combinations (${offset} total trades)`);
  return trades;
}

// ---------------------------------------------------------------------------
// 4. Replay trades and compute correct holdings
// ---------------------------------------------------------------------------
function replayTrades(baselineQty, baselineAvg, baselineInvested, baselineRealizedPl, trades) {
  let qty = baselineQty;
  let avg = baselineAvg;
  let invested = baselineInvested;
  let realizedPl = baselineRealizedPl;
  let lastDate = null;

  for (const t of trades) {
    if (t.side === 'BUY') {
      const newQty = qty + t.quantity;
      avg = newQty > 0 ? (qty * avg + t.net_value) / newQty : 0;
      invested += t.net_value;
      qty = newQty;
    } else {
      // SELL
      const costBasis = avg > 0 ? avg : t.price;
      realizedPl += t.net_value - costBasis * t.quantity;
      qty = Math.max(0, qty - t.quantity);
      // avg doesn't change on sells
    }
    lastDate = t.trade_date;
  }

  return {
    quantity: qty,
    average_cost: Math.round(avg * 100) / 100,
    total_invested: Math.round(invested * 100) / 100,
    realized_pl: Math.round(realizedPl * 100) / 100,
    as_of_date: lastDate,
  };
}

// ---------------------------------------------------------------------------
// 5. Main repair
// ---------------------------------------------------------------------------
async function main() {
  const csvPath = process.argv[2] || '/Users/sharraf/Downloads/Admin Balance 12.01.csv';
  console.log(`Reading baseline from: ${csvPath}\n`);

  const baseline = parseAdminBalanceCSV(csvPath);
  const { clientMap, secMap } = await buildMaps();
  const allTrades = await fetchAllTrades();

  // Build set of all client+isin keys we need to repair
  const allKeys = new Set([...baseline.holdings.keys()]);
  // Also include holdings that only exist from trades (no baseline)
  for (const key of allTrades.keys()) {
    const [clientId, isin] = key.split('|');
    // Find client_code for this client_id
    let clientCode = null;
    for (const [code, id] of clientMap) {
      if (id === clientId) { clientCode = code; break; }
    }
    // Find security_code for this isin
    let secCode = null;
    for (const [code, dbIsin] of secMap) {
      if (dbIsin === isin) { secCode = code; break; }
    }
    if (clientCode && secCode) allKeys.add(`${clientCode}|${secCode}`);
  }

  console.log(`\nRepairing ${allKeys.size} holdings...\n`);

  let updated = 0, skipped = 0, errors = 0;
  const clientsToFixCash = new Set();

  for (const baselineKey of allKeys) {
    const [clientCode, secCode] = baselineKey.split('|');
    const clientId = clientMap.get(clientCode);
    const isin = secMap.get(secCode);
    if (!clientId || !isin) { skipped++; continue; }

    const bl = baseline.holdings.get(baselineKey);
    const baseQty = bl?.quantity ?? 0;
    const baseAvg = bl?.average_cost ?? 0;
    const baseInvested = bl?.total_cost ?? 0;

    const tradeKey = `${clientId}|${isin}`;
    const trades = allTrades.get(tradeKey) || [];

    const correct = replayTrades(baseQty, baseAvg, baseInvested, 0, trades);

    // Determine as_of_date
    const asOfDate = correct.as_of_date || '2026-01-12';

    const { error } = await supabase.from('holdings').upsert({
      client_id: clientId,
      isin,
      quantity: correct.quantity,
      average_cost: correct.average_cost,
      total_invested: correct.total_invested,
      realized_pl: correct.realized_pl,
      as_of_date: asOfDate,
    }, { onConflict: 'client_id,isin' });

    if (error) {
      console.error(`  Error updating ${clientCode}/${secCode}: ${error.message}`);
      errors++;
    } else {
      updated++;
      if (trades.length > 0) clientsToFixCash.add(clientId);
    }

    if (updated % 500 === 0 && updated > 0) {
      process.stdout.write(`  updated ${updated} holdings...\r`);
    }
  }

  console.log(`\nHoldings repair: ${updated} updated, ${skipped} skipped, ${errors} errors`);

  // ---------------------------------------------------------------------------
  // 6. Fix cash_ledger running_balance for all clients with trades
  // ---------------------------------------------------------------------------
  console.log(`\nFixing cash_ledger for ${clientsToFixCash.size} clients...`);
  let cashFixed = 0;
  for (const clientId of clientsToFixCash) {
    const { error } = await supabase.rpc('recalc_running_balance', { p_client_id: clientId });
    if (error) {
      console.error(`  Cash fix error for ${clientId}: ${error.message}`);
    } else {
      cashFixed++;
    }
    if (cashFixed % 100 === 0 && cashFixed > 0) {
      process.stdout.write(`  fixed ${cashFixed} clients...\r`);
    }
  }
  console.log(`Cash ledger fix: ${cashFixed} clients repaired\n`);

  // Verify client 15570
  console.log('=== Verification: client 15570 ===');
  const { data: h15570 } = await supabase.from('holdings')
    .select('isin, quantity, average_cost, total_invested, realized_pl')
    .eq('client_id', clientMap.get('15570'))
    .gt('quantity', 0);
  console.table(h15570);

  const cid = clientMap.get('15570');
  const { data: cash15570 } = await supabase.from('cash_ledger')
    .select('id, type, amount, running_balance')
    .eq('client_id', cid)
    .order('id')
    .limit(5);
  console.log('\nFirst 5 cash_ledger entries:');
  console.table(cash15570);

  console.log('\nDone!');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
