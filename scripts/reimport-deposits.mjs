/**
 * Reimport deposits: delete old DEPOSIT/WITHDRAWAL entries and re-import from file.
 * Uses service role key to bypass RLS.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import * as XLSX from 'xlsx';

const SUPABASE_URL = 'https://zuupegtizrvbnsliuddu.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp1dXBlZ3RpenJ2Ym5zbGl1ZGR1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTg3ODE1NCwiZXhwIjoyMDg3NDU0MTU0fQ.fE4D9Y0mFGzY6NT2aqnA9MLQJqHVQRB5VGo6II0zKx0';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const DEPOSIT_FILE = 'C:/repos/eod/data/Deposit Withdrawal 01.02.2026.xlsx';
const DATA_DATE = '2026-02-01';
const BATCH_SIZE = 500;
const LOOKUP_BATCH = 300;

// ── Parser (same logic as deposit-parser.ts, with footer row fix) ──
function parseDepositXlsx(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const allDeposits = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
    if (rows.length === 0) continue;

    const sn = sheetName.toLowerCase();
    const sheetTypeOverride =
      (sn.includes('receipt') || sn.includes('deposit')) ? 'DEPOSIT' :
      (sn.includes('payment') || sn.includes('withdraw')) ? 'WITHDRAWAL' :
      null;

    const keys = Object.keys(rows[0]);
    const findCol = (...candidates) =>
      keys.find(k => candidates.some(c => k.toLowerCase().includes(c.toLowerCase())));

    const boIdCol = findCol('BOID', 'BO ID', 'bo_id', 'Beneficiary');
    const clientCodeCol = findCol('Inv. Code', 'Inv.Code', 'InvCode', 'ClientCode', 'Client Code', 'client_code', 'Investor Code', 'Account');
    const dateCol = findCol('Date', 'TransactionDate', 'Transaction Date', 'Txn Date');
    const singleAmountCol = findCol('Amount', 'Amt');
    const debitCol = findCol('Debit');
    const creditCol = findCol('Credit');
    const typeCol = findCol('Tr. Type', 'Tr.Type', 'Type', 'Transaction Type', 'Txn Type', 'Category');
    const refCol = findCol('Cheque No', 'Cheque', 'Reference', 'Ref', 'Transfer ID');
    const narrationCol = findCol('Descriptions', 'Description', 'Narration', 'Remarks', 'Memo');
    const slCol = keys.find(k => k.toLowerCase() === 'sl');

    const hasSeparateDebitCredit = !!(debitCol && creditCol);

    for (const row of rows) {
      // Skip footer/summary rows
      if (slCol) {
        const sl = row[slCol];
        if (sl != null && typeof sl !== 'number') continue;
      }

      const getVal = (col) => {
        if (!col) return null;
        const v = row[col];
        if (v == null) return null;
        return String(v).trim();
      };
      const getNum = (col) => {
        if (!col) return 0;
        const v = row[col];
        if (v == null) return 0;
        const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
        return isNaN(n) ? 0 : n;
      };

      let amount;
      if (hasSeparateDebitCredit) {
        const debit = getNum(debitCol);
        const credit = getNum(creditCol);
        amount = credit - debit;
      } else {
        amount = getNum(singleAmountCol);
      }
      if (amount === 0) continue;

      let transDate = getVal(dateCol) || '';
      if (transDate.includes('T')) transDate = transDate.split('T')[0];

      let type = getVal(typeCol);
      if (type) {
        const tLower = type.toLowerCase();
        if (tLower === 'receipt' || tLower.includes('deposit') || tLower.includes('credit') || tLower === 'receive') {
          type = 'DEPOSIT';
        } else if (tLower === 'payment' || tLower === 'paid' || tLower.includes('withdrawal') || tLower.includes('debit')) {
          type = 'WITHDRAWAL';
        } else {
          type = type.toUpperCase();
        }
      } else if (sheetTypeOverride) {
        type = sheetTypeOverride;
      } else {
        type = amount >= 0 ? 'DEPOSIT' : 'WITHDRAWAL';
      }

      if (type === 'WITHDRAWAL' && amount > 0) amount = -amount;

      const clientCode = getVal(clientCodeCol);
      const boId = getVal(boIdCol);
      if (!clientCode && !boId) continue;

      allDeposits.push({
        bo_id: boId,
        client_code: clientCode,
        transaction_date: transDate,
        amount,
        type,
        reference: getVal(refCol),
        narration: getVal(narrationCol),
      });
    }
  }

  return allDeposits;
}

// ── Main ──
async function main() {
  console.log('=== Deposit/Withdrawal Reimport ===\n');

  // Step 1: Delete old data
  console.log('Step 1: Deleting old DEPOSIT/WITHDRAWAL entries from cash_ledger...');
  const { error: delDepErr, count: delDepCount } = await supabase
    .from('cash_ledger')
    .delete({ count: 'exact' })
    .eq('type', 'DEPOSIT');
  console.log(`  Deleted DEPOSIT entries: ${delDepCount ?? 'unknown'}${delDepErr ? ` (error: ${delDepErr.message})` : ''}`);

  const { error: delWdErr, count: delWdCount } = await supabase
    .from('cash_ledger')
    .delete({ count: 'exact' })
    .eq('type', 'WITHDRAWAL');
  console.log(`  Deleted WITHDRAWAL entries: ${delWdCount ?? 'unknown'}${delWdErr ? ` (error: ${delWdErr.message})` : ''}`);

  // Delete old import_audit records for this file type
  const { error: delAuditErr, count: delAuditCount } = await supabase
    .from('import_audit')
    .delete({ count: 'exact' })
    .eq('file_type', 'DEPOSIT_WITHDRAWAL');
  console.log(`  Deleted DEPOSIT_WITHDRAWAL audit records: ${delAuditCount ?? 'unknown'}${delAuditErr ? ` (error: ${delAuditErr.message})` : ''}`);

  // Step 2: Parse the deposit file
  console.log('\nStep 2: Parsing deposit file...');
  const buffer = readFileSync(DEPOSIT_FILE);
  const deposits = parseDepositXlsx(buffer);

  const depositRows = deposits.filter(d => d.type === 'DEPOSIT');
  const withdrawalRows = deposits.filter(d => d.type === 'WITHDRAWAL');
  const depositSum = depositRows.reduce((s, d) => s + d.amount, 0);
  const withdrawalSum = withdrawalRows.reduce((s, d) => s + d.amount, 0);

  console.log(`  Total parsed: ${deposits.length}`);
  console.log(`  DEPOSIT: ${depositRows.length} rows, total: ${depositSum.toLocaleString()} BDT (${(depositSum / 10000000).toFixed(2)} crore)`);
  console.log(`  WITHDRAWAL: ${withdrawalRows.length} rows, total: ${withdrawalSum.toLocaleString()} BDT (${(Math.abs(withdrawalSum) / 10000000).toFixed(2)} crore)`);

  // Step 3: Create audit record
  console.log('\nStep 3: Creating import audit record...');
  const { data: auditData, error: auditErr } = await supabase
    .from('import_audit')
    .insert({
      file_name: 'Deposit Withdrawal 01.02.2026.xlsx',
      file_type: 'DEPOSIT_WITHDRAWAL',
      status: 'PROCESSING',
      total_rows: deposits.length,
      data_date: DATA_DATE,
    })
    .select()
    .single();

  if (auditErr) {
    console.error('  Failed to create audit:', auditErr.message);
    return;
  }
  const auditId = auditData.id;
  console.log(`  Audit ID: ${auditId}`);

  // Step 4: Build client lookup
  console.log('\nStep 4: Building client lookup...');
  const clientCodes = [...new Set(deposits.map(d => d.client_code).filter(Boolean))];
  const codeToClientId = new Map();

  for (let i = 0; i < clientCodes.length; i += LOOKUP_BATCH) {
    const batch = clientCodes.slice(i, i + LOOKUP_BATCH);
    const { data, error } = await supabase
      .from('clients')
      .select('client_id, client_code')
      .in('client_code', batch);

    if (error) {
      console.error(`  Lookup error: ${error.message}`);
    } else if (data) {
      for (const row of data) {
        if (row.client_code) codeToClientId.set(row.client_code, row.client_id);
      }
    }
  }
  console.log(`  Found ${codeToClientId.size} clients out of ${clientCodes.length} unique codes`);

  // Step 5: Get latest balances
  console.log('\nStep 5: Fetching current balances...');
  const allClientIds = [...new Set(
    deposits.map(d => d.client_code ? codeToClientId.get(d.client_code) : null).filter(Boolean)
  )];
  const balanceMap = new Map();

  for (let i = 0; i < allClientIds.length; i += LOOKUP_BATCH) {
    const batch = allClientIds.slice(i, i + LOOKUP_BATCH);
    const { data } = await supabase
      .from('cash_ledger')
      .select('client_id, running_balance')
      .in('client_id', batch)
      .order('id', { ascending: false });

    if (data) {
      for (const row of data) {
        if (!balanceMap.has(row.client_id)) balanceMap.set(row.client_id, row.running_balance);
      }
    }
  }
  console.log(`  Got balances for ${balanceMap.size} clients`);

  // Step 6: Build and insert cash ledger rows
  console.log('\nStep 6: Building cash ledger entries...');
  const currentBalance = new Map();
  for (const [cid, bal] of balanceMap) currentBalance.set(cid, bal);

  const cashRows = [];
  let skippedNoClient = 0;

  for (const d of deposits) {
    const clientId = d.client_code ? codeToClientId.get(d.client_code) : null;
    if (!clientId) {
      skippedNoClient++;
      continue;
    }

    const prevBalance = currentBalance.get(clientId) ?? 0;
    const newBalance = prevBalance + d.amount;
    currentBalance.set(clientId, newBalance);

    const txDate = d.transaction_date || DATA_DATE;

    cashRows.push({
      client_id: clientId,
      transaction_date: txDate,
      value_date: txDate,
      amount: d.amount,
      running_balance: newBalance,
      type: d.type,
      reference: d.reference,
      narration: d.narration,
    });
  }

  console.log(`  Prepared ${cashRows.length} entries (skipped ${skippedNoClient} — client not found)`);

  // Show some skipped client codes for debugging
  if (skippedNoClient > 0) {
    const missingCodes = [...new Set(
      deposits.filter(d => d.client_code && !codeToClientId.has(d.client_code)).map(d => d.client_code)
    )];
    console.log(`  Missing client codes (first 10): ${missingCodes.slice(0, 10).join(', ')}`);
  }

  console.log('\nStep 7: Batch inserting...');
  let inserted = 0;
  const errors = [];

  for (let i = 0; i < cashRows.length; i += BATCH_SIZE) {
    const batch = cashRows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from('cash_ledger').insert(batch);
    if (error) {
      errors.push(`Batch ${Math.floor(i / BATCH_SIZE)}: ${error.message}`);
      console.error(`  Batch ${Math.floor(i / BATCH_SIZE)} error: ${error.message}`);
    } else {
      inserted += batch.length;
    }
  }

  console.log(`  Inserted: ${inserted} / ${cashRows.length}`);

  // Step 8: Update audit
  const status = errors.length > 0 ? (inserted > 0 ? 'PARTIAL' : 'FAILED') : 'SUCCESS';
  await supabase
    .from('import_audit')
    .update({
      total_rows: deposits.length,
      processed_rows: inserted,
      rejected_rows: deposits.length - inserted,
      status,
      error_details: errors.length > 0 ? { errors } : null,
    })
    .eq('id', auditId);

  // Step 9: Verify
  console.log('\n=== Verification ===');
  const { data: depCheck } = await supabase.rpc('get_import_summary');
  if (depCheck) {
    console.log(`  Deposits: ${depCheck.deposit_count} entries, BDT ${Number(depCheck.deposit_total).toLocaleString()} (${(Number(depCheck.deposit_total) / 10000000).toFixed(2)} crore)`);
    console.log(`  Withdrawals: ${depCheck.withdrawal_count} entries, BDT ${Number(depCheck.withdrawal_total).toLocaleString()} (${(Number(depCheck.withdrawal_total) / 10000000).toFixed(2)} crore)`);
    console.log(`  Opening Balances: ${depCheck.opening_balance_count} entries, BDT ${Number(depCheck.opening_balance_total).toLocaleString()}`);
  }

  console.log('\nDone!');
}

main().catch(console.error);
