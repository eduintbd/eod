/**
 * Restore missing OPENING_BALANCE entries from the Jan 12 admin balance CSV.
 *
 * Steps:
 * 1. Parse the CSV to get unique clients + ledger balances
 * 2. Query DB for clients that already have OPENING_BALANCE
 * 3. Map bo_id -> client_id
 * 4. Insert OPENING_BALANCE for clients that don't have one
 * 5. Recalculate running balances for all clients with deposits/withdrawals
 */

import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Papa = require('../frontend/node_modules/papaparse');

const SUPABASE_URL = 'https://zuupegtizrvbnsliuddu.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp1dXBlZ3RpenJ2Ym5zbGl1ZGR1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTg3ODE1NCwiZXhwIjoyMDg3NDU0MTU0fQ.fE4D9Y0mFGzY6NT2aqnA9MLQJqHVQRB5VGo6II0zKx0';
const HEADERS = {
  'apikey': KEY,
  'Authorization': `Bearer ${KEY}`,
  'Content-Type': 'application/json',
};

function parseFormattedNumber(s) {
  if (!s || s.trim() === '' || s.trim() === '#N/A') return 0;
  let cleaned = s.trim();
  const isNeg = cleaned.includes('(') && cleaned.includes(')');
  cleaned = cleaned.replace(/[()]/g, '').replace(/,/g, '').trim();
  const num = parseFloat(cleaned);
  if (isNaN(num)) return 0;
  return isNeg ? -num : num;
}

async function supaGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`GET ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function supaPost(path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: { ...HEADERS, 'Prefer': 'return=minimal' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path}: ${res.status} ${await res.text()}`);
  return res;
}

async function supaRpc(fn, params) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`RPC ${fn}: ${res.status} ${await res.text()}`);
  return res.json();
}

// ── Step 1: Parse CSV ──
console.log('Parsing CSV...');
const csvPath = process.argv[2] || 'data/Admin Balance 12.01.2026.csv';
const csvText = fs.readFileSync(csvPath, 'utf-8');
const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });

// Extract unique clients with their ledger balance
const clientBalances = new Map(); // bo_id -> { client_code, ledger_balance }
for (const row of parsed.data) {
  const code = row['Investor Code']?.trim();
  const boId = row['BOID']?.trim();
  if (!code || !boId) continue;
  if (clientBalances.has(boId)) continue; // first row per client has the balance

  const ledgerBalance = parseFormattedNumber(row['Ledger Balance']);
  clientBalances.set(boId, { client_code: code, ledger_balance: ledgerBalance });
}

console.log(`Found ${clientBalances.size} unique clients in CSV`);

// ── Step 2: Get clients that already have OPENING_BALANCE ──
console.log('Fetching existing OPENING_BALANCE client_ids...');
const existingOB = new Set();
let offset = 0;
while (true) {
  const data = await supaGet(
    `cash_ledger?type=eq.OPENING_BALANCE&select=client_id&offset=${offset}&limit=1000`
  );
  for (const row of data) existingOB.add(row.client_id);
  if (data.length < 1000) break;
  offset += 1000;
}
console.log(`${existingOB.size} clients already have OPENING_BALANCE`);

// ── Step 3: Map bo_id -> client_id ──
console.log('Building bo_id -> client_id lookup...');
const boIdToClientId = new Map();
const allBoIds = [...clientBalances.keys()];
for (let i = 0; i < allBoIds.length; i += 500) {
  const batch = allBoIds.slice(i, i + 500);
  const data = await supaGet(
    `clients?select=client_id,bo_id&bo_id=in.(${batch.join(',')})`
  );
  for (const row of data) {
    boIdToClientId.set(row.bo_id, row.client_id);
  }
}
console.log(`Mapped ${boIdToClientId.size} bo_ids to client_ids`);

// ── Step 4: Find clients needing OPENING_BALANCE ──
const toInsert = [];
let skippedZero = 0;
let skippedNoClient = 0;
let skippedHasOB = 0;

for (const [boId, info] of clientBalances) {
  const clientId = boIdToClientId.get(boId);
  if (!clientId) { skippedNoClient++; continue; }
  if (existingOB.has(clientId)) { skippedHasOB++; continue; }
  if (info.ledger_balance === 0) { skippedZero++; continue; }

  toInsert.push({
    client_id: clientId,
    transaction_date: '2026-01-13',
    value_date: '2026-01-13',
    amount: info.ledger_balance,
    running_balance: info.ledger_balance,
    type: 'OPENING_BALANCE',
    narration: 'Closing balance as of 2026-01-12 (baseline for daily processing)',
    import_audit_id: 20,
  });
}

console.log(`\nSummary:`);
console.log(`  Already have OB: ${skippedHasOB}`);
console.log(`  Zero balance (skip): ${skippedZero}`);
console.log(`  No client in DB: ${skippedNoClient}`);
console.log(`  TO INSERT: ${toInsert.length}`);

// ── Step 5: Insert in batches ──
if (toInsert.length > 0) {
  console.log(`\nInserting ${toInsert.length} OPENING_BALANCE entries...`);
  const BATCH = 200;
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const batch = toInsert.slice(i, i + BATCH);
    await supaPost('cash_ledger', batch);
    process.stdout.write(`  ${Math.min(i + BATCH, toInsert.length)}/${toInsert.length}\r`);
  }
  console.log(`\nInserted ${toInsert.length} OPENING_BALANCE entries.`);
}

// ── Step 6: Recalculate running balances ──
// Get all clients that have deposit/withdrawal entries (they may need recalc)
console.log('\nFinding clients with deposit/withdrawal entries...');
const depositClients = new Set();
offset = 0;
while (true) {
  const data = await supaGet(
    `cash_ledger?type=in.(DEPOSIT,WITHDRAWAL)&select=client_id&offset=${offset}&limit=1000`
  );
  for (const row of data) depositClients.add(row.client_id);
  if (data.length < 1000) break;
  offset += 1000;
}
console.log(`${depositClients.size} clients have deposit/withdrawal entries`);

// Check if recalc_running_balance RPC exists
console.log('Recalculating running balances...');
let recalcCount = 0;
let recalcErrors = 0;
const clientArray = [...depositClients];

for (let i = 0; i < clientArray.length; i++) {
  try {
    await supaRpc('recalc_running_balance', { p_client_id: clientArray[i] });
    recalcCount++;
  } catch (err) {
    recalcErrors++;
    if (recalcErrors <= 3) console.error(`  Recalc error for ${clientArray[i]}: ${err.message}`);
    if (recalcErrors === 3) {
      console.error('  RPC may not exist, trying alternative approach...');
      break;
    }
  }
  if ((i + 1) % 50 === 0) process.stdout.write(`  ${i + 1}/${clientArray.length}\r`);
}

console.log(`\nRecalculated: ${recalcCount}, Errors: ${recalcErrors}`);
console.log('Done!');
