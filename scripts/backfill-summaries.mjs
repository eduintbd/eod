import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const envText = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
}
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// ── 1. DSE Trade summary from XML file ──
console.log('=== Computing DSE trade summary from XML ===');
const dseText = readFileSync(new URL('../data/13.01.2026/20260113-144801-trades-UBR-out.xml', import.meta.url), 'latin1');
const detailRegex = /<Detail\b([^>]*)\/?>/g;
let match;

function attr(str, name) {
  const m = str.match(new RegExp(name + '="([^"]*)"'));
  return m ? m[1] : null;
}

const dseFills = [];
while ((match = detailRegex.exec(dseText)) !== null) {
  const attrs = match[1];
  const status = attr(attrs, 'Status');
  if (status !== 'FILL' && status !== 'PF') continue;
  const qty = parseFloat(attr(attrs, 'Quantity') || '0');
  if (qty <= 0) continue;
  dseFills.push({
    side: attr(attrs, 'Side'),
    value: parseFloat(attr(attrs, 'Value') || '0'),
  });
}

const dseSummary = {
  dse_buy_count: dseFills.filter(t => t.side === 'B').length,
  dse_buy_value: dseFills.filter(t => t.side === 'B').reduce((s, t) => s + t.value, 0),
  dse_sell_count: dseFills.filter(t => t.side === 'S').length,
  dse_sell_value: dseFills.filter(t => t.side === 'S').reduce((s, t) => s + t.value, 0),
  cse_buy_count: 0,
  cse_buy_value: 0,
  cse_sell_count: 0,
  cse_sell_value: 0,
  total_turnover: 0,
};
dseSummary.total_turnover = dseSummary.dse_buy_value + dseSummary.dse_sell_value;

console.log(`  DSE Buy: ${dseSummary.dse_buy_count} (${(dseSummary.dse_buy_value / 1e7).toFixed(2)} Cr)`);
console.log(`  DSE Sell: ${dseSummary.dse_sell_count} (${(dseSummary.dse_sell_value / 1e7).toFixed(2)} Cr)`);
console.log(`  Turnover: ${(dseSummary.total_turnover / 1e7).toFixed(2)} Cr`);

// ── 2. CSE Trade summary from text file ──
console.log('\n=== Computing CSE trade summary from text file ===');
const cseText = readFileSync(new URL('../data/13.01.2026/CSE/BT_WITH_TRADE_FLAG.txt', import.meta.url), 'utf8');
const cseLines = cseText.split(/\r?\n/).filter(l => l.trim());
// Skip header
const cseHeader = cseLines[0];
console.log(`  Header: ${cseHeader.substring(0, 100)}`);

const cseFills = [];
for (let i = 1; i < cseLines.length; i++) {
  const cols = cseLines[i].split('|');
  if (cols.length < 10) continue;
  // CSE parser format varies — check what fields exist
  // From the cse-text-parser, let's check the actual structure
  const status = (cols[1] || '').trim();
  if (status !== 'FILL' && status !== 'PF') continue;
  const side = (cols[4] || '').trim();
  const qty = parseFloat(cols[8] || '0');
  const value = parseFloat(cols[10] || '0');
  if (qty <= 0) continue;
  cseFills.push({ side: side === 'B' || side === 'BUY' ? 'B' : 'S', value });
}

const cseSummary = {
  dse_buy_count: 0,
  dse_buy_value: 0,
  dse_sell_count: 0,
  dse_sell_value: 0,
  cse_buy_count: cseFills.filter(t => t.side === 'B').length,
  cse_buy_value: cseFills.filter(t => t.side === 'B').reduce((s, t) => s + t.value, 0),
  cse_sell_count: cseFills.filter(t => t.side === 'S').length,
  cse_sell_value: cseFills.filter(t => t.side === 'S').reduce((s, t) => s + t.value, 0),
  total_turnover: 0,
};
cseSummary.total_turnover = cseSummary.cse_buy_value + cseSummary.cse_sell_value;

console.log(`  CSE Buy: ${cseSummary.cse_buy_count} (${cseSummary.cse_buy_value.toLocaleString()})`);
console.log(`  CSE Sell: ${cseSummary.cse_sell_count} (${cseSummary.cse_sell_value.toLocaleString()})`);
console.log(`  Turnover: ${cseSummary.total_turnover.toLocaleString()}`);

// If CSE parser didn't work with assumed column positions, use the actual parser
if (cseFills.length === 0) {
  console.log('  (CSE parsing returned 0 — will check raw_trades DB for CSE values)');
  // Fallback: get from DB
  let off = 0;
  while (true) {
    const { data } = await sb.from('raw_trades')
      .select('side, value')
      .eq('trade_date', '2026-01-13')
      .eq('source', 'CSE')
      .in('status', ['FILL', 'PF'])
      .gt('quantity', 0)
      .range(off, off + 999);
    if (!data || data.length === 0) break;
    for (const t of data) {
      const v = Number(t.value) || 0;
      if (t.side === 'B') { cseSummary.cse_buy_count++; cseSummary.cse_buy_value += v; }
      else if (t.side === 'S') { cseSummary.cse_sell_count++; cseSummary.cse_sell_value += v; }
    }
    off += 1000;
    if (data.length < 1000) break;
  }
  cseSummary.total_turnover = cseSummary.cse_buy_value + cseSummary.cse_sell_value;
  console.log(`  CSE Buy (from DB): ${cseSummary.cse_buy_count} (${cseSummary.cse_buy_value.toLocaleString()})`);
  console.log(`  CSE Sell (from DB): ${cseSummary.cse_sell_count} (${cseSummary.cse_sell_value.toLocaleString()})`);
  console.log(`  Turnover: ${cseSummary.total_turnover.toLocaleString()}`);
}

// ── 3. Deposit summary from DB (audit 29) ──
console.log('\n=== Computing deposit summary from cash_ledger (audit 29) ===');
let depOff = 0;
let depCount = 0, depTotal = 0, wdCount = 0, wdTotal = 0;
while (true) {
  const { data } = await sb.from('cash_ledger')
    .select('type, amount')
    .eq('import_audit_id', 29)
    .range(depOff, depOff + 999);
  if (!data || data.length === 0) break;
  for (const r of data) {
    if (r.type === 'DEPOSIT') { depCount++; depTotal += Number(r.amount) || 0; }
    else if (r.type === 'WITHDRAWAL') { wdCount++; wdTotal += Math.abs(Number(r.amount) || 0); }
  }
  depOff += 1000;
  if (data.length < 1000) break;
}

const depositSummary = {
  deposit_count: depCount,
  deposit_total: depTotal,
  withdrawal_count: wdCount,
  withdrawal_total: wdTotal,
  net_deposit: depTotal - wdTotal,
};

console.log(`  Deposits: ${depCount} (+${(depTotal / 1e7).toFixed(2)} Cr)`);
console.log(`  Withdrawals: ${wdCount} (-${(wdTotal / 1e7).toFixed(2)} Cr)`);
console.log(`  Net: ${((depTotal - wdTotal) / 1e7).toFixed(2)} Cr`);

// ── 4. Processing summary from trade_executions ──
console.log('\n=== Computing processing summary from trade_executions ===');
let exOff = 0;
let totalValue = 0, totalCommission = 0, totalFees = 0;
const byExchangeSide = {};
while (true) {
  const { data } = await sb.from('trade_executions')
    .select('exchange, side, value, commission, exchange_fee, cdbl_fee, ait')
    .eq('trade_date', '2026-01-13')
    .range(exOff, exOff + 999);
  if (!data || data.length === 0) break;
  for (const r of data) {
    const key = `${r.exchange}_${r.side}`;
    if (!byExchangeSide[key]) byExchangeSide[key] = { count: 0, value: 0, commission: 0, fees: 0 };
    const v = Number(r.value) || 0;
    const c = Number(r.commission) || 0;
    const ef = Number(r.exchange_fee) || 0;
    const cf = Number(r.cdbl_fee) || 0;
    const a = Number(r.ait) || 0;
    byExchangeSide[key].count++;
    byExchangeSide[key].value += v;
    byExchangeSide[key].commission += c;
    byExchangeSide[key].fees += ef + cf + a;
    totalValue += v;
    totalCommission += c;
    totalFees += ef + cf + a;
  }
  exOff += 1000;
  if (data.length < 1000) break;
}

const commissionPct = totalValue > 0 ? (totalCommission / totalValue) * 100 : 0;
const processingSummary = {
  total_executions: Object.values(byExchangeSide).reduce((s, v) => s + v.count, 0),
  total_value: totalValue,
  total_commission: totalCommission,
  total_fees: totalFees,
  commission_pct: Math.round(commissionPct * 10000) / 10000,
  max_allowed_pct: 2,
  by_exchange_side: byExchangeSide,
};

console.log(`  Executions: ${processingSummary.total_executions}`);
console.log(`  Total Value: ${(totalValue / 1e7).toFixed(2)} Cr`);
console.log(`  Commission: ${totalCommission.toLocaleString()} (${commissionPct.toFixed(4)}%)`);
console.log(`  Fees: ${totalFees.toLocaleString()}`);
for (const [k, v] of Object.entries(byExchangeSide)) {
  console.log(`    ${k}: ${v.count} trades, ${(v.value / 1e7).toFixed(2)} Cr`);
}

// ── 5. Update audit records ──
console.log('\n=== UPDATING AUDIT RECORDS ===');

// Audit 21 — DSE_TRADE (main import)
const { data: a21 } = await sb.from('import_audit').select('error_details').eq('id', 21).single();
const existing21 = a21?.error_details || {};
const { error: e21 } = await sb.from('import_audit').update({
  error_details: { ...existing21, summary: dseSummary, processing_summary: processingSummary },
}).eq('id', 21);
console.log(`  Audit 21 (DSE_TRADE): ${e21 ? 'ERROR ' + e21.message : 'OK'}`);

// Audit 25 — CSE_TRADE
const { data: a25 } = await sb.from('import_audit').select('error_details').eq('id', 25).single();
const existing25 = a25?.error_details || {};
const { error: e25 } = await sb.from('import_audit').update({
  error_details: { ...existing25, summary: cseSummary },
}).eq('id', 25);
console.log(`  Audit 25 (CSE_TRADE): ${e25 ? 'ERROR ' + e25.message : 'OK'}`);

// Audit 29 — DEPOSIT_WITHDRAWAL
const { data: a29 } = await sb.from('import_audit').select('error_details').eq('id', 29).single();
const existing29 = a29?.error_details || {};
const { error: e29 } = await sb.from('import_audit').update({
  error_details: { ...existing29, summary: depositSummary },
}).eq('id', 29);
console.log(`  Audit 29 (DEPOSIT): ${e29 ? 'ERROR ' + e29.message : 'OK'}`);

// ── 6. Verify ──
console.log('\n=== VERIFICATION ===');
const { data: updated } = await sb.from('import_audit').select('id, file_type, error_details')
  .in('id', [21, 25, 29]);
for (const a of updated || []) {
  const s = a.error_details?.summary;
  const p = a.error_details?.processing_summary;
  console.log(`  ID:${a.id} (${a.file_type}):`);
  if (s) console.log(`    summary: ${JSON.stringify(s)}`);
  if (p) console.log(`    processing: executions=${p.total_executions}, commission=${p.commission_pct}%`);
}
