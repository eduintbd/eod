import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { parseDseXml } from '@/parsers/dse-xml-parser';
import { parseCseText } from '@/parsers/cse-text-parser';
import { parseAdminBalance } from '@/parsers/admin-balance-parser';
import { parseDepositXlsx } from '@/parsers/deposit-parser';
import type { RawTrade, ImportAudit, ImportState, ReconciliationResult } from '@/lib/types';

export type FileType = 'DSE_TRADE' | 'CSE_TRADE' | 'ADMIN_BALANCE' | 'DEPOSIT_WITHDRAWAL';

export interface ImportProgress {
  stage: 'idle' | 'parsing' | 'uploading' | 'processing' | 'done' | 'error' | 'reconciliation';
  message?: string;
  totalRows: number;
  uploadedRows: number;
  processedRows: number;
  rejectedRows: number;
  errorMessage?: string;
  reconciliationResult?: ReconciliationResult;
}

export interface DateValidation {
  ok: boolean;
  error?: string;    // blocking
  warning?: string;  // non-blocking
}

// ── Import state helpers ──

export async function getImportState(): Promise<ImportState | null> {
  const { data, error } = await supabase
    .from('import_state')
    .select('*')
    .eq('id', 1)
    .single();

  if (error || !data) return null;
  return data as ImportState;
}

export async function validateDailyImportDate(
  fileType: FileType,
  dateStr: string,
): Promise<DateValidation> {
  const state = await getImportState();

  if (!state?.baseline_date) {
    return { ok: false, error: 'No baseline imported yet. Import an Admin Balance CSV first.' };
  }

  if (dateStr <= state.baseline_date) {
    return {
      ok: false,
      error: `Cannot import for ${dateStr} — on or before baseline date (${state.baseline_date}). Daily imports must be after the baseline.`,
    };
  }

  const warnings: string[] = [];

  // Gap warning
  const lastDate = state.last_processed_date || state.baseline_date;
  const lastMs = new Date(lastDate).getTime();
  const importMs = new Date(dateStr).getTime();
  const gapDays = Math.round((importMs - lastMs) / (1000 * 60 * 60 * 24));
  if (gapDays > 4) {
    warnings.push(`${gapDays}-day gap since last processed date (${lastDate}). Missing trading days?`);
  }

  // Duplicate file_type + data_date warning
  const mappedType = fileType === 'DSE_TRADE' || fileType === 'CSE_TRADE' ? fileType : fileType;
  const { data: existing } = await supabase
    .from('import_audit')
    .select('id')
    .eq('file_type', mappedType)
    .eq('data_date', dateStr)
    .in('status', ['SUCCESS', 'PARTIAL'])
    .limit(1);

  if (existing && existing.length > 0) {
    if (fileType === 'DEPOSIT_WITHDRAWAL') {
      warnings.push(`A successful ${fileType} import for ${dateStr} already exists. It will be replaced.`);
    } else {
      warnings.push(`A successful ${fileType} import for ${dateStr} already exists. May create duplicates.`);
    }
  }

  return {
    ok: true,
    warning: warnings.length > 0 ? warnings.join(' ') : undefined,
  };
}

async function updateLastProcessedDate(dateStr: string): Promise<void> {
  // Only advance forward, never backward
  const { error } = await supabase
    .from('import_state')
    .update({ last_processed_date: dateStr })
    .eq('id', 1)
    .or(`last_processed_date.is.null,last_processed_date.lt.${dateStr}`);

  if (error) console.error('Failed to update last_processed_date:', error.message);
}

const BATCH_SIZE = 500;
const LOOKUP_BATCH = 300;

function detectFileType(file: File): FileType {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xml')) return 'DSE_TRADE';
  if (name.endsWith('.txt')) return 'CSE_TRADE';
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    if (name.includes('deposit') || name.includes('withdrawal')) return 'DEPOSIT_WITHDRAWAL';
    return 'DEPOSIT_WITHDRAWAL'; // Default for Excel
  }
  if (name.endsWith('.csv')) return 'ADMIN_BALANCE';
  throw new Error(`Cannot detect file type for: ${file.name}`);
}

async function readFileAsText(file: File, encoding?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, encoding);
  });
}

async function readFileAsBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

async function batchInsert(
  table: string,
  rows: Record<string, unknown>[],
  onProgress: (count: number) => void,
): Promise<{ inserted: number; errors: string[] }> {
  let inserted = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from(table).insert(batch);
    if (error) {
      errors.push(`Batch ${Math.floor(i / BATCH_SIZE)}: ${error.message}`);
    } else {
      inserted += batch.length;
    }
    onProgress(inserted);
  }

  return { inserted, errors };
}

export function useImport() {
  const [progress, setProgress] = useState<ImportProgress>({
    stage: 'idle',
    totalRows: 0,
    uploadedRows: 0,
    processedRows: 0,
    rejectedRows: 0,
  });
  const [lastAuditId, setLastAuditId] = useState<number | null>(null);

  const reset = useCallback(() => {
    setProgress({
      stage: 'idle',
      totalRows: 0,
      uploadedRows: 0,
      processedRows: 0,
      rejectedRows: 0,
    });
    setLastAuditId(null);
  }, []);

  const importFile = useCallback(async (file: File, fileType?: FileType, asOfDate?: string) => {
    const type = fileType || detectFileType(file);
    const dateStr = asOfDate || new Date().toISOString().slice(0, 10);

    setProgress({
      stage: 'parsing',
      totalRows: 0,
      uploadedRows: 0,
      processedRows: 0,
      rejectedRows: 0,
    });

    let audit: unknown = null;
    try {
      // Create import audit record
      const { data: auditData, error: auditErr } = await supabase
        .from('import_audit')
        .insert({
          file_name: file.name,
          file_type: type,
          status: 'PROCESSING',
          total_rows: 0,
          data_date: dateStr,
        })
        .select()
        .single();

      if (auditErr) {
        throw new Error(`Failed to create audit record: ${auditErr.message}`);
      }

      audit = auditData;
      const auditId = (auditData as ImportAudit).id;
      setLastAuditId(auditId);

      if (type === 'DSE_TRADE' || type === 'CSE_TRADE') {
        await importTradeFile(file, type, auditId, dateStr);
      } else if (type === 'ADMIN_BALANCE') {
        await importAdminBalance(file, auditId, dateStr);
      } else if (type === 'DEPOSIT_WITHDRAWAL') {
        await importDeposits(file, auditId, dateStr);
      }
    } catch (err) {
      // Update audit record to FAILED if we have an auditId
      if (audit) {
        await supabase
          .from('import_audit')
          .update({
            status: 'FAILED',
            error_details: { error: err instanceof Error ? err.message : String(err) },
          })
          .eq('id', (audit as ImportAudit).id);
      }

      setProgress(p => ({
        ...p,
        stage: 'error',
        errorMessage: err instanceof Error ? err.message : String(err),
      }));
    }
  }, []);

  const importTradeFile = async (file: File, type: FileType, auditId: number, dateStr: string) => {
    // DSE XML files use ISO-8859-1 encoding
    const encoding = type === 'DSE_TRADE' ? 'ISO-8859-1' : undefined;
    const text = await readFileAsText(file, encoding);

    let trades: RawTrade[];
    if (type === 'DSE_TRADE') {
      trades = parseDseXml(text, file.name);
    } else {
      trades = parseCseText(text, file.name);
    }

    setProgress(p => ({ ...p, totalRows: trades.length, stage: 'uploading', message: 'Checking for duplicates...' }));

    // ── Deduplicate: remove trades whose exec_id already exists in raw_trades ──
    const execIds = trades
      .map(t => t.exec_id)
      .filter((id): id is string => id != null && id !== '');

    const existingExecIds = new Set<string>();
    for (let i = 0; i < execIds.length; i += LOOKUP_BATCH) {
      const batch = execIds.slice(i, i + LOOKUP_BATCH);
      const { data } = await supabase
        .from('raw_trades')
        .select('exec_id')
        .in('exec_id', batch);
      if (data) {
        for (const row of data) existingExecIds.add(row.exec_id);
      }
    }

    const uniqueTrades = trades.filter(t => !t.exec_id || !existingExecIds.has(t.exec_id));
    const skippedDuplicates = trades.length - uniqueTrades.length;

    setProgress(p => ({
      ...p,
      totalRows: trades.length,
      message: skippedDuplicates > 0
        ? `Skipping ${skippedDuplicates.toLocaleString()} duplicate trades...`
        : 'Uploading trades...',
    }));

    // Add audit ID and prepare for insert
    const rows = uniqueTrades.map(t => ({
      ...t,
      import_audit_id: auditId,
    }));

    const { inserted, errors } = await batchInsert(
      'raw_trades',
      rows,
      (count) => setProgress(p => ({ ...p, uploadedRows: count })),
    );

    if (skippedDuplicates > 0) {
      errors.push(`${skippedDuplicates} duplicate trades skipped (exec_id already exists)`);
    }

    // ── Compute exchange-wise trade summary stats ──
    const fills = trades.filter(t => t.status === 'FILL' || t.status === 'PF');
    const sumValue = (arr: typeof fills) => arr.reduce((s, t) => s + (Number(t.value) || 0), 0);
    const summary = {
      dse_buy_count: fills.filter(t => t.source === 'DSE' && t.side === 'B').length,
      dse_buy_value: sumValue(fills.filter(t => t.source === 'DSE' && t.side === 'B')),
      dse_sell_count: fills.filter(t => t.source === 'DSE' && t.side === 'S').length,
      dse_sell_value: sumValue(fills.filter(t => t.source === 'DSE' && t.side === 'S')),
      cse_buy_count: fills.filter(t => t.source === 'CSE' && t.side === 'B').length,
      cse_buy_value: sumValue(fills.filter(t => t.source === 'CSE' && t.side === 'B')),
      cse_sell_count: fills.filter(t => t.source === 'CSE' && t.side === 'S').length,
      cse_sell_value: sumValue(fills.filter(t => t.source === 'CSE' && t.side === 'S')),
      total_turnover: 0,
    };
    summary.total_turnover = summary.dse_buy_value + summary.dse_sell_value
      + summary.cse_buy_value + summary.cse_sell_value;

    // Update audit record
    const status = errors.length > 0
      ? (inserted > 0 ? 'PARTIAL' : 'FAILED')
      : 'SUCCESS';

    await supabase
      .from('import_audit')
      .update({
        total_rows: trades.length,
        processed_rows: inserted,
        rejected_rows: trades.length - inserted,
        status,
        error_details: { summary, ...(errors.length > 0 ? { errors } : {}) },
      })
      .eq('id', auditId);

    // Update last_processed_date for this trade date
    if (status === 'SUCCESS' || status === 'PARTIAL') {
      await updateLastProcessedDate(dateStr);
    }

    setProgress(p => ({
      ...p,
      stage: 'done',
      processedRows: inserted,
      rejectedRows: trades.length - inserted,
    }));
  };

  const importAdminBalance = async (file: File, auditId: number, dateStr: string) => {
    const text = await readFileAsText(file);
    const parsed = parseAdminBalance(text);

    // ── Baseline guard: check if a baseline already exists ──
    const state = await getImportState();
    if (state?.baseline_date) {
      // Switch to reconciliation mode — compare file vs DB, no overwrite
      await importAdminBalanceReconcile(parsed, auditId, dateStr, state);
      return;
    }

    // ── Normal first-time baseline import ──
    const totalRows = parsed.clients.length + parsed.holdings.length;
    setProgress(p => ({ ...p, totalRows, stage: 'uploading', message: 'Upserting clients...' }));

    let processedCount = 0;
    const errors: string[] = [];

    // ── Step 1: Batch upsert clients ──
    for (let i = 0; i < parsed.clients.length; i += BATCH_SIZE) {
      const batch = parsed.clients.slice(i, i + BATCH_SIZE).map(c => ({
        bo_id: c.bo_id,
        client_code: c.client_code,
        name: c.name,
        account_type: c.account_type,
        commission_rate: c.commission_rate / 100,
        department: c.department,
        status: 'active',
      }));

      const { error } = await supabase
        .from('clients')
        .upsert(batch, { onConflict: 'bo_id' });

      if (error) {
        console.error('Client upsert error:', error);
        errors.push(`Client batch ${Math.floor(i / BATCH_SIZE)}: ${error.message}`);
      } else {
        processedCount += batch.length;
      }
      setProgress(p => ({ ...p, uploadedRows: processedCount }));
    }

    // ── Step 2: Build bo_id → client_id lookup map ──
    setProgress(p => ({ ...p, message: 'Building client lookup...' }));
    const boIds = parsed.clients.map(c => c.bo_id);
    const clientMap = new Map<string, string>();

    for (let i = 0; i < boIds.length; i += LOOKUP_BATCH) {
      const batch = boIds.slice(i, i + LOOKUP_BATCH);
      const { data, error } = await supabase
        .from('clients')
        .select('client_id, bo_id')
        .in('bo_id', batch);

      if (error) {
        errors.push(`Client lookup batch: ${error.message}`);
      } else if (data) {
        for (const row of data) clientMap.set(row.bo_id, row.client_id);
      }
    }

    // ── Step 3: Batch insert cash ledger opening balances ──
    setProgress(p => ({ ...p, message: 'Processing cash ledger...' }));
    const allClientIds = Array.from(clientMap.values());
    const existingOB = new Set<string>();

    for (let i = 0; i < allClientIds.length; i += LOOKUP_BATCH) {
      const batch = allClientIds.slice(i, i + LOOKUP_BATCH);
      const { data } = await supabase
        .from('cash_ledger')
        .select('client_id')
        .in('client_id', batch)
        .eq('type', 'OPENING_BALANCE');

      if (data) {
        for (const row of data) existingOB.add(row.client_id);
      }
    }

    const cashRows = parsed.clients
      .filter(c => c.ledger_balance !== 0 && clientMap.has(c.bo_id) && !existingOB.has(clientMap.get(c.bo_id)!))
      .map(c => ({
        client_id: clientMap.get(c.bo_id)!,
        transaction_date: dateStr,
        value_date: dateStr,
        amount: c.ledger_balance,
        running_balance: c.ledger_balance,
        type: 'OPENING_BALANCE',
        narration: `Closing balance as of ${dateStr} (baseline for daily processing)`,
        import_audit_id: auditId,
      }));

    for (let i = 0; i < cashRows.length; i += BATCH_SIZE) {
      const batch = cashRows.slice(i, i + BATCH_SIZE);
      const { error } = await supabase.from('cash_ledger').insert(batch);
      if (error) {
        errors.push(`Cash ledger batch ${Math.floor(i / BATCH_SIZE)}: ${error.message}`);
      }
    }

    // ── Step 4: Batch upsert securities (deduplicated) ──
    setProgress(p => ({ ...p, message: 'Upserting securities...' }));
    const uniqueSecCodes = [...new Set(parsed.holdings.map(h => h.security_code))];
    const secRows = uniqueSecCodes.map(code => ({
      isin: `PLACEHOLDER-${code}`,
      security_code: code,
      company_name: code,
      asset_class: 'EQ',
      status: 'active',
    }));

    for (let i = 0; i < secRows.length; i += BATCH_SIZE) {
      const batch = secRows.slice(i, i + BATCH_SIZE);
      const { error } = await supabase
        .from('securities')
        .upsert(batch, { onConflict: 'security_code', ignoreDuplicates: true });
      if (error) {
        errors.push(`Securities batch ${Math.floor(i / BATCH_SIZE)}: ${error.message}`);
      }
    }

    // ── Step 5: Build security_code → isin lookup map ──
    setProgress(p => ({ ...p, message: 'Building security lookup...' }));
    const secMap = new Map<string, string>();

    for (let i = 0; i < uniqueSecCodes.length; i += LOOKUP_BATCH) {
      const batch = uniqueSecCodes.slice(i, i + LOOKUP_BATCH);
      const { data, error } = await supabase
        .from('securities')
        .select('isin, security_code')
        .in('security_code', batch);

      if (error) {
        errors.push(`Security lookup batch: ${error.message}`);
      } else if (data) {
        for (const row of data) secMap.set(row.security_code, row.isin);
      }
    }

    // ── Step 6: Batch upsert holdings ──
    setProgress(p => ({ ...p, message: 'Upserting holdings...' }));
    const holdingRows = parsed.holdings
      .filter(h => clientMap.has(h.bo_id) && secMap.has(h.security_code))
      .map(h => ({
        client_id: clientMap.get(h.bo_id)!,
        isin: secMap.get(h.security_code)!,
        quantity: h.quantity,
        average_cost: h.average_cost,
        total_invested: h.total_cost,
        realized_pl: 0,
        as_of_date: dateStr,
        import_audit_id: auditId,
      }));

    const skippedHoldings = parsed.holdings.length - holdingRows.length;
    if (skippedHoldings > 0) {
      errors.push(`${skippedHoldings} holdings skipped (missing client or security mapping)`);
    }

    for (let i = 0; i < holdingRows.length; i += BATCH_SIZE) {
      const batch = holdingRows.slice(i, i + BATCH_SIZE);
      const { error } = await supabase
        .from('holdings')
        .upsert(batch, { onConflict: 'client_id,isin' });

      if (error) {
        errors.push(`Holdings batch ${Math.floor(i / BATCH_SIZE)}: ${error.message}`);
      } else {
        processedCount += batch.length;
      }
      setProgress(p => ({ ...p, uploadedRows: processedCount }));
    }

    // ── Set baseline in import_state ──
    const finalStatus = errors.length > 0
      ? (processedCount > 0 ? 'PARTIAL' : 'FAILED')
      : 'SUCCESS';

    if (finalStatus === 'SUCCESS' || finalStatus === 'PARTIAL') {
      await supabase
        .from('import_state')
        .update({
          baseline_date: dateStr,
          last_processed_date: dateStr,
          baseline_import_audit_id: auditId,
        })
        .eq('id', 1);
    }

    // ── Final: Update audit record ──
    await supabase
      .from('import_audit')
      .update({
        total_rows: totalRows,
        processed_rows: processedCount,
        rejected_rows: totalRows - processedCount,
        status: finalStatus,
        error_details: errors.length > 0 ? { errors: errors.slice(0, 50) } : null,
      })
      .eq('id', auditId);

    setProgress(p => ({
      ...p,
      stage: 'done',
      message: undefined,
      processedRows: processedCount,
      rejectedRows: totalRows - processedCount,
    }));
  };

  // ── Reconciliation mode: compare file vs DB, no overwrite ──
  const importAdminBalanceReconcile = async (
    parsed: ReturnType<typeof parseAdminBalance>,
    auditId: number,
    _dateStr: string,
    _state: ImportState,
  ) => {
    setProgress(p => ({
      ...p,
      stage: 'uploading',
      message: 'Reconciliation mode — comparing file with database...',
      totalRows: parsed.clients.length + parsed.holdings.length,
    }));

    const errors: string[] = [];

    // Build bo_id → client_id + name lookup
    const boIds = parsed.clients.map(c => c.bo_id);
    const clientMap = new Map<string, { client_id: string; name: string | null }>();

    for (let i = 0; i < boIds.length; i += LOOKUP_BATCH) {
      const batch = boIds.slice(i, i + LOOKUP_BATCH);
      const { data } = await supabase
        .from('clients')
        .select('client_id, bo_id, name')
        .in('bo_id', batch);
      if (data) {
        for (const row of data) clientMap.set(row.bo_id, { client_id: row.client_id, name: row.name });
      }
    }

    // Build security_code → isin lookup
    const uniqueSecCodes = [...new Set(parsed.holdings.map(h => h.security_code))];
    const secMap = new Map<string, string>();

    for (let i = 0; i < uniqueSecCodes.length; i += LOOKUP_BATCH) {
      const batch = uniqueSecCodes.slice(i, i + LOOKUP_BATCH);
      const { data } = await supabase
        .from('securities')
        .select('isin, security_code')
        .in('security_code', batch);
      if (data) {
        for (const row of data) secMap.set(row.security_code, row.isin);
      }
    }

    // ── Compare holdings ──
    setProgress(p => ({ ...p, message: 'Comparing holdings...' }));
    const holdingMismatches: ReconciliationResult['holdingMismatches'] = [];
    let matchedHoldings = 0;

    // Fetch DB holdings for all relevant clients
    const allClientIds = [...new Set(
      boIds.map(b => clientMap.get(b)?.client_id).filter((id): id is string => id != null)
    )];
    const dbHoldings = new Map<string, { quantity: number; average_cost: number }>();

    for (let i = 0; i < allClientIds.length; i += LOOKUP_BATCH) {
      const batch = allClientIds.slice(i, i + LOOKUP_BATCH);
      const { data } = await supabase
        .from('holdings')
        .select('client_id, isin, quantity, average_cost')
        .in('client_id', batch);
      if (data) {
        for (const row of data) {
          dbHoldings.set(`${row.client_id}:${row.isin}`, {
            quantity: row.quantity,
            average_cost: Number(row.average_cost),
          });
        }
      }
    }

    for (const h of parsed.holdings) {
      const client = clientMap.get(h.bo_id);
      const isin = secMap.get(h.security_code);
      if (!client || !isin) continue;

      const key = `${client.client_id}:${isin}`;
      const dbH = dbHoldings.get(key);
      const dbQty = dbH?.quantity ?? 0;
      const dbAvg = dbH?.average_cost ?? 0;

      if (h.quantity !== dbQty || Math.abs(h.average_cost - dbAvg) > 0.01) {
        holdingMismatches.push({
          client_id: client.client_id,
          client_name: client.name,
          bo_id: h.bo_id,
          isin,
          security_code: h.security_code,
          file_qty: h.quantity,
          db_qty: dbQty,
          diff_qty: h.quantity - dbQty,
          file_avg_cost: h.average_cost,
          db_avg_cost: dbAvg,
          diff_avg_cost: h.average_cost - dbAvg,
        });
      } else {
        matchedHoldings++;
      }
    }

    // ── Compare cash balances ──
    setProgress(p => ({ ...p, message: 'Comparing cash balances...' }));
    const cashMismatches: ReconciliationResult['cashMismatches'] = [];
    let matchedCash = 0;

    // Get latest running_balance per client from DB
    const dbBalances = new Map<string, number>();
    for (let i = 0; i < allClientIds.length; i += LOOKUP_BATCH) {
      const batch = allClientIds.slice(i, i + LOOKUP_BATCH);
      const { data } = await supabase
        .from('cash_ledger')
        .select('client_id, running_balance')
        .in('client_id', batch)
        .order('id', { ascending: false });
      if (data) {
        for (const row of data) {
          if (!dbBalances.has(row.client_id)) {
            dbBalances.set(row.client_id, Number(row.running_balance));
          }
        }
      }
    }

    for (const c of parsed.clients) {
      const client = clientMap.get(c.bo_id);
      if (!client) continue;

      const dbBal = dbBalances.get(client.client_id) ?? 0;
      const fileBal = c.ledger_balance;

      if (Math.abs(fileBal - dbBal) > 0.01) {
        cashMismatches.push({
          client_id: client.client_id,
          client_name: client.name,
          bo_id: c.bo_id,
          file_balance: fileBal,
          db_balance: dbBal,
          diff: fileBal - dbBal,
        });
      } else {
        matchedCash++;
      }
    }

    const reconciliation: ReconciliationResult = {
      holdingMismatches,
      cashMismatches,
      matchedHoldings,
      matchedCash,
    };

    // Update audit as reconciliation (not a real import)
    await supabase
      .from('import_audit')
      .update({
        total_rows: parsed.clients.length + parsed.holdings.length,
        processed_rows: 0,
        rejected_rows: 0,
        status: 'SUCCESS',
        error_details: {
          mode: 'reconciliation',
          holding_mismatches: holdingMismatches.length,
          cash_mismatches: cashMismatches.length,
          matched_holdings: matchedHoldings,
          matched_cash: matchedCash,
          errors: errors.slice(0, 50),
        },
      })
      .eq('id', auditId);

    setProgress(p => ({
      ...p,
      stage: 'reconciliation',
      message: undefined,
      processedRows: matchedHoldings + matchedCash,
      rejectedRows: holdingMismatches.length + cashMismatches.length,
      reconciliationResult: reconciliation,
    }));
  };

  const importDeposits = async (file: File, auditId: number, dateStr: string) => {
    const buffer = await readFileAsBuffer(file);
    const deposits = parseDepositXlsx(buffer, file.name);

    setProgress(p => ({ ...p, totalRows: deposits.length, stage: 'uploading', message: 'Building client lookup...' }));

    const errors: string[] = [];

    // ── Step 0: Check for existing deposit import for this date (replace-import dedup) ──
    const { data: existingAudits } = await supabase
      .from('import_audit')
      .select('id')
      .eq('file_type', 'DEPOSIT_WITHDRAWAL')
      .eq('data_date', dateStr)
      .in('status', ['SUCCESS', 'PARTIAL']);

    const oldAuditIds = (existingAudits ?? []).map(a => a.id).filter(id => id !== auditId);
    let replacedClients = new Set<string>();

    if (oldAuditIds.length > 0) {
      setProgress(p => ({ ...p, message: 'Replacing previous deposit import for this date...' }));

      // Collect affected client_ids before deleting
      for (const oldId of oldAuditIds) {
        const { data: oldEntries } = await supabase
          .from('cash_ledger')
          .select('client_id')
          .eq('import_audit_id', oldId);
        if (oldEntries) {
          for (const e of oldEntries) replacedClients.add(e.client_id);
        }

        // Delete old entries
        await supabase
          .from('cash_ledger')
          .delete()
          .eq('import_audit_id', oldId);

        // Mark old audit as replaced
        await supabase
          .from('import_audit')
          .update({ status: 'FAILED', error_details: { replaced_by: auditId } })
          .eq('id', oldId);
      }
    }

    // ── Step 1: Build client lookup map (batched) ──
    const clientCodes = [...new Set(deposits.map(d => d.client_code).filter((c): c is string => c != null))];
    const boIds = [...new Set(deposits.map(d => d.bo_id).filter((b): b is string => b != null))];

    const codeToClientId = new Map<string, string>();
    const boIdToClientId = new Map<string, string>();

    for (let i = 0; i < clientCodes.length; i += LOOKUP_BATCH) {
      const batch = clientCodes.slice(i, i + LOOKUP_BATCH);
      const { data, error } = await supabase
        .from('clients')
        .select('client_id, client_code')
        .in('client_code', batch);

      if (error) {
        errors.push(`Client code lookup: ${error.message}`);
      } else if (data) {
        for (const row of data) {
          if (row.client_code) codeToClientId.set(row.client_code, row.client_id);
        }
      }
    }

    for (let i = 0; i < boIds.length; i += LOOKUP_BATCH) {
      const batch = boIds.slice(i, i + LOOKUP_BATCH);
      const { data, error } = await supabase
        .from('clients')
        .select('client_id, bo_id')
        .in('bo_id', batch);

      if (error) {
        errors.push(`BO ID lookup: ${error.message}`);
      } else if (data) {
        for (const row of data) {
          if (row.bo_id) boIdToClientId.set(row.bo_id, row.client_id);
        }
      }
    }

    function resolveClientId(d: { bo_id: string | null; client_code: string | null }): string | null {
      if (d.client_code && codeToClientId.has(d.client_code)) return codeToClientId.get(d.client_code)!;
      if (d.bo_id && boIdToClientId.has(d.bo_id)) return boIdToClientId.get(d.bo_id)!;
      return null;
    }

    // ── Step 2: Get latest running balance per client (batched) ──
    setProgress(p => ({ ...p, message: 'Fetching current balances...' }));

    const allClientIds = [...new Set(
      deposits.map(d => resolveClientId(d)).filter((id): id is string => id != null)
    )];

    const balanceMap = new Map<string, number>();
    for (let i = 0; i < allClientIds.length; i += LOOKUP_BATCH) {
      const batch = allClientIds.slice(i, i + LOOKUP_BATCH);
      const { data } = await supabase
        .from('cash_ledger')
        .select('client_id, running_balance')
        .in('client_id', batch)
        .order('id', { ascending: false });

      if (data) {
        for (const row of data) {
          if (!balanceMap.has(row.client_id)) {
            balanceMap.set(row.client_id, row.running_balance);
          }
        }
      }
    }

    // ── Step 3: Build cash ledger rows with running balances ──
    setProgress(p => ({ ...p, message: 'Preparing cash ledger entries...' }));

    const currentBalance = new Map<string, number>();
    for (const [cid, bal] of balanceMap) currentBalance.set(cid, bal);

    const cashRows: Array<Record<string, unknown>> = [];
    let skippedNoClient = 0;

    for (const d of deposits) {
      const clientId = resolveClientId(d);
      if (!clientId) {
        skippedNoClient++;
        continue;
      }

      const prevBalance = currentBalance.get(clientId) ?? 0;
      const newBalance = prevBalance + d.amount;
      currentBalance.set(clientId, newBalance);

      const txDate = d.transaction_date || dateStr;

      cashRows.push({
        client_id: clientId,
        transaction_date: txDate,
        value_date: txDate,
        amount: d.amount,
        running_balance: newBalance,
        type: d.type,
        reference: d.reference,
        narration: d.narration,
        import_audit_id: auditId,
      });
    }

    if (skippedNoClient > 0) {
      errors.push(`${skippedNoClient} rows skipped (client not found in database)`);
    }

    // ── Step 4: Batch insert cash ledger entries ──
    setProgress(p => ({ ...p, message: `Inserting ${cashRows.length} cash ledger entries...` }));

    let processedCount = 0;
    for (let i = 0; i < cashRows.length; i += BATCH_SIZE) {
      const batch = cashRows.slice(i, i + BATCH_SIZE);
      const { error } = await supabase.from('cash_ledger').insert(batch);
      if (error) {
        errors.push(`Cash ledger batch ${Math.floor(i / BATCH_SIZE)}: ${error.message}`);
      } else {
        processedCount += batch.length;
      }
      setProgress(p => ({ ...p, uploadedRows: processedCount }));
    }

    // ── Step 5: Recalc running balance for clients affected by replace-import ──
    if (replacedClients.size > 0) {
      setProgress(p => ({ ...p, message: `Recalculating balances for ${replacedClients.size} clients...` }));
      for (const clientId of replacedClients) {
        await supabase.rpc('recalc_running_balance', { p_client_id: clientId });
      }
    }

    // ── Step 6: Update last_processed_date ──
    await updateLastProcessedDate(dateStr);

    // ── Compute deposit/withdrawal summary stats ──
    const depositRows = cashRows.filter(r => r.type === 'DEPOSIT');
    const withdrawalRows = cashRows.filter(r => r.type === 'WITHDRAWAL');
    const summary = {
      deposit_count: depositRows.length,
      deposit_total: depositRows.reduce((s, r) => s + (r.amount as number), 0),
      withdrawal_count: withdrawalRows.length,
      withdrawal_total: withdrawalRows.reduce((s, r) => s + Math.abs(r.amount as number), 0),
      net_deposit: 0,
    };
    summary.net_deposit = summary.deposit_total - summary.withdrawal_total;

    // ── Final: Update audit record ──
    const status = errors.length > 0
      ? (processedCount > 0 ? 'PARTIAL' : 'FAILED')
      : 'SUCCESS';

    await supabase
      .from('import_audit')
      .update({
        total_rows: deposits.length,
        processed_rows: processedCount,
        rejected_rows: deposits.length - processedCount,
        status,
        error_details: { summary, ...(errors.length > 0 ? { errors: errors.slice(0, 50) } : {}) },
      })
      .eq('id', auditId);

    setProgress(p => ({
      ...p,
      stage: 'done',
      message: oldAuditIds.length > 0
        ? `Replaced previous import. ${replacedClients.size} client balances recalculated.`
        : undefined,
      processedRows: processedCount,
      rejectedRows: deposits.length - processedCount,
    }));
  };

  // Trigger trade processing edge function — loops in batches of 200 until done
  const processTrades = useCallback(async (importAuditId?: number) => {
    setProgress(p => ({ ...p, stage: 'processing', message: 'Processing trades...' }));

    let totalProcessed = 0;
    let totalFailed = 0;
    let batchNum = 0;

    // Loop until no more trades to process
    while (true) {
      batchNum++;
      setProgress(p => ({
        ...p,
        message: `Processing batch ${batchNum}... (${totalProcessed} processed so far)`,
      }));

      const { data, error } = await supabase.functions.invoke('process-trades', {
        body: { import_audit_id: importAuditId },
      });

      if (error) {
        // If we already processed some, show partial success
        if (totalProcessed > 0) {
          setProgress(p => ({
            ...p,
            stage: 'done',
            message: undefined,
            processedRows: totalProcessed,
            rejectedRows: totalFailed,
            errorMessage: `Processed ${totalProcessed} trades. Batch ${batchNum} failed: ${error.message}`,
          }));
          return;
        }

        let errorMsg = error.message;
        if (data?.error) errorMsg = data.error;
        setProgress(p => ({
          ...p,
          stage: 'error',
          message: undefined,
          errorMessage: errorMsg,
        }));
        return;
      }

      const batchProcessed = data?.processed_count ?? 0;
      const batchFailed = data?.failed_count ?? 0;
      totalProcessed += batchProcessed;
      totalFailed += batchFailed;

      // If this batch had no trades, we're done
      if (batchProcessed === 0 && batchFailed === 0) break;

      // If there were fewer than 200 trades in this batch, we're done
      const totalInBatch = (data?.total_raw ?? 0);
      if (totalInBatch < 200) break;

      setProgress(p => ({
        ...p,
        processedRows: totalProcessed,
        rejectedRows: totalFailed,
      }));
    }

    // ── Post-processing: compute commission summary and update trade audit ──
    if (totalProcessed > 0 && importAuditId) {
      try {
        // Get data_date from the audit record
        const { data: auditRec } = await supabase
          .from('import_audit')
          .select('data_date')
          .eq('id', importAuditId)
          .single();

        const dateStr = auditRec?.data_date;
        if (dateStr) {
          const { data: commRows } = await supabase
            .from('trade_executions')
            .select('exchange, side, value, commission, exchange_fee, cdbl_fee, ait')
            .eq('trade_date', dateStr);

          if (commRows && commRows.length > 0) {
            let totalValue = 0, totalCommission = 0, totalFees = 0;
            const byExchangeSide: Record<string, { count: number; value: number; commission: number; fees: number }> = {};

            for (const r of commRows) {
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

            const commissionPct = totalValue > 0 ? (totalCommission / totalValue) * 100 : 0;

            const processingSummary = {
              total_executions: commRows.length,
              total_value: totalValue,
              total_commission: totalCommission,
              total_fees: totalFees,
              commission_pct: Math.round(commissionPct * 10000) / 10000,
              max_allowed_pct: 2,
              by_exchange_side: byExchangeSide,
            };

            // Find the trade-type audit for this date and merge processing_summary
            const { data: tradeAudit } = await supabase
              .from('import_audit')
              .select('id, error_details')
              .in('file_type', ['DSE_TRADE', 'CSE_TRADE'])
              .eq('data_date', dateStr)
              .in('status', ['SUCCESS', 'PARTIAL'])
              .order('id', { ascending: false })
              .limit(1)
              .single();

            if (tradeAudit) {
              const existing = (tradeAudit.error_details as Record<string, unknown>) ?? {};
              await supabase
                .from('import_audit')
                .update({
                  error_details: { ...existing, processing_summary: processingSummary },
                })
                .eq('id', tradeAudit.id);
            }
          }
        }
      } catch (e) {
        console.error('Failed to compute commission summary:', e);
      }
    }

    setProgress(p => ({
      ...p,
      stage: 'done',
      message: undefined,
      processedRows: totalProcessed,
      rejectedRows: totalFailed,
    }));

    return { processed_count: totalProcessed, failed_count: totalFailed };
  }, []);

  return { progress, importFile, processTrades, reset, detectFileType, lastAuditId, getImportState, validateDailyImportDate };
}
