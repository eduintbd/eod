/**
 * Negative Balance / Unsettled Issues Report
 *
 * Queries the database to generate the same report as
 * "Overall unsettled issues 13.02.2026.xlsx"
 *
 * Usage: node scripts/negative-balance-report.mjs
 */
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const envText = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
}
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const PAGE = 1000;

// ── Step 1: Get latest cash balance per client ──
console.log('=== SCANNING CASH LEDGER FOR LATEST BALANCES ===');

const latestByClient = new Map(); // client_id -> { running_balance, transaction_date, type, reference, narration, id }
let offset = 0;
let totalScanned = 0;

while (true) {
  const { data, error } = await sb
    .from('cash_ledger')
    .select('id, client_id, transaction_date, running_balance, type, reference, narration')
    .order('id', { ascending: false })
    .range(offset, offset + PAGE - 1);

  if (error) {
    console.error('Error fetching cash_ledger:', error.message);
    break;
  }
  if (!data || data.length === 0) break;

  for (const row of data) {
    if (!latestByClient.has(row.client_id)) {
      latestByClient.set(row.client_id, row);
    }
  }

  totalScanned += data.length;
  offset += PAGE;
  if (data.length < PAGE) break;
}

console.log(`Scanned ${totalScanned} ledger entries, found ${latestByClient.size} unique clients`);

// ── Step 2: Filter for negative balances ──
const negativeClients = [];
for (const [clientId, entry] of latestByClient) {
  if (Number(entry.running_balance) < 0) {
    negativeClients.push({ clientId, ...entry });
  }
}
negativeClients.sort((a, b) => Number(a.running_balance) - Number(b.running_balance));

console.log(`\n=== FOUND ${negativeClients.length} CLIENTS WITH NEGATIVE BALANCE ===\n`);

if (negativeClients.length === 0) {
  console.log('No negative balances found. All clients are in good standing.');
  process.exit(0);
}

// ── Step 3: Get client details ──
const clientIds = negativeClients.map(c => c.clientId);
const clientMap = new Map();

for (let i = 0; i < clientIds.length; i += 100) {
  const batch = clientIds.slice(i, i + 100);
  const { data } = await sb
    .from('clients')
    .select('client_id, client_code, name, department, rm_id')
    .in('client_id', batch);
  for (const c of data || []) {
    clientMap.set(c.client_id, c);
  }
}

// ── Step 4: Get RM names ──
const rmIds = [...new Set([...clientMap.values()].map(c => c.rm_id).filter(Boolean))];
const rmMap = new Map();
if (rmIds.length > 0) {
  for (let i = 0; i < rmIds.length; i += 100) {
    const batch = rmIds.slice(i, i + 100);
    const { data } = await sb
      .from('app_users')
      .select('id, full_name, department')
      .in('id', batch);
    for (const rm of data || []) {
      rmMap.set(rm.id, rm);
    }
  }
}

// ── Step 5: Get history to find when balance went negative ──
const historyMap = new Map();
for (let i = 0; i < clientIds.length; i += 20) {
  const batch = clientIds.slice(i, i + 20);
  const { data } = await sb
    .from('cash_ledger')
    .select('id, client_id, transaction_date, running_balance, type, narration')
    .in('client_id', batch)
    .order('id', { ascending: false })
    .limit(2000);
  for (const row of data || []) {
    if (!historyMap.has(row.client_id)) historyMap.set(row.client_id, []);
    historyMap.get(row.client_id).push(row);
  }
}

// ── Step 6: Build report ──
const today = new Date();
const issues = [];

for (const neg of negativeClients) {
  const client = clientMap.get(neg.clientId);
  if (!client) continue;

  const history = historyMap.get(neg.clientId) || [];

  // Find when balance went negative
  let eventDate = neg.transaction_date;
  let triggeringType = neg.type;
  let triggeringNarration = neg.narration || '';

  for (let i = 0; i < history.length; i++) {
    if (Number(history[i].running_balance) >= 0) {
      if (i > 0) {
        eventDate = history[i - 1].transaction_date;
        triggeringType = history[i - 1].type;
        triggeringNarration = history[i - 1].narration || '';
      }
      break;
    }
    if (i === history.length - 1) {
      eventDate = history[i].transaction_date;
      triggeringType = history[i].type;
      triggeringNarration = history[i].narration || '';
    }
  }

  // Non-compliance type
  let nonComplianceType = 'Negative Balance';
  if (triggeringType === 'BUY_TRADE') {
    nonComplianceType = 'Negative Balance-OMS Trade';
  }

  // Extract instrument from narration
  let instruments = 'NA';
  if (triggeringNarration) {
    const match = triggeringNarration.match(/^(?:BUY|SELL)\s+\d+\s+(\S+)/);
    if (match) instruments = match[1];
  }

  // RM info
  const rm = client.rm_id ? rmMap.get(client.rm_id) : null;
  const rmName = rm?.full_name || 'N/A';

  // Unsettled days
  const eventDateObj = new Date(eventDate);
  const unsettledDays = Math.max(1, Math.ceil(
    (today.getTime() - eventDateObj.getTime()) / (1000 * 60 * 60 * 24)
  ));

  issues.push({
    eventDate,
    clientCode: client.client_code || '',
    clientName: client.name || '',
    instruments,
    amount: Number(neg.running_balance),
    rmName,
    nonComplianceType,
    department: client.department || 'N/A',
    unsettledDays,
  });
}

// Compute RM frequency (only for known RMs, not N/A)
const rmFreqMap = new Map();
for (const issue of issues) {
  if (issue.rmName !== 'N/A') {
    rmFreqMap.set(issue.rmName, (rmFreqMap.get(issue.rmName) || 0) + 1);
  }
}

function getDiscipline(freq) {
  if (freq === 0) return 'N/A';
  if (freq >= 4) return 'A/C not to be counted in performance';
  if (freq >= 3) return '2nd Meeting with HoD & ICCD';
  if (freq >= 2) return '1st Meeting with HoD & ICCD';
  return 'ICCD Notice';
}

// ── Step 7: Print report ──
console.log('SL | Event Date  | Code       | Client Name                  | Instruments | Amount (BDT)     | RM                 | Type                       | Dept       | RM Freq | Days | Disciplinary');
console.log('-'.repeat(200));

issues.forEach((issue, idx) => {
  const rmFreq = issue.rmName !== 'N/A' ? (rmFreqMap.get(issue.rmName) || 0) : 0;
  const discipline = getDiscipline(rmFreq);

  console.log(
    `${String(idx + 1).padStart(2)} | ` +
    `${issue.eventDate.padEnd(11)} | ` +
    `${issue.clientCode.padEnd(10)} | ` +
    `${issue.clientName.slice(0, 28).padEnd(28)} | ` +
    `${issue.instruments.padEnd(11)} | ` +
    `${String(issue.amount.toFixed(2)).padStart(16)} | ` +
    `${issue.rmName.slice(0, 18).padEnd(18)} | ` +
    `${issue.nonComplianceType.padEnd(26)} | ` +
    `${issue.department.slice(0, 10).padEnd(10)} | ` +
    `${String(rmFreq).padStart(7)} | ` +
    `${String(issue.unsettledDays).padStart(4)} | ` +
    `${discipline}`
  );
});

// ── Summary ──
const totalNeg = issues.reduce((s, i) => s + i.amount, 0);
const byType = {};
for (const i of issues) {
  byType[i.nonComplianceType] = (byType[i.nonComplianceType] || 0) + 1;
}

console.log('\n=== SUMMARY ===');
console.log(`Total accounts with negative balance: ${issues.length}`);
console.log(`Total negative amount: BDT ${totalNeg.toFixed(2)}`);
console.log(`Unique RMs: ${new Set(issues.map(i => i.rmName).filter(n => n !== 'N/A')).size}`);
console.log('By type:');
for (const [type, count] of Object.entries(byType)) {
  console.log(`  ${type}: ${count}`);
}
console.log('\nRM Frequency:');
for (const [rm, freq] of [...rmFreqMap.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${rm}: ${freq} clients → ${getDiscipline(freq)}`);
}
