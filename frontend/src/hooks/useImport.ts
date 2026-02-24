import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { parseDseXml } from '@/parsers/dse-xml-parser';
import { parseCseText } from '@/parsers/cse-text-parser';
import { parseAdminBalance } from '@/parsers/admin-balance-parser';
import { parseDepositXlsx } from '@/parsers/deposit-parser';
import type { RawTrade, ImportAudit } from '@/lib/types';

export type FileType = 'DSE_TRADE' | 'CSE_TRADE' | 'ADMIN_BALANCE' | 'DEPOSIT_WITHDRAWAL';

export interface ImportProgress {
  stage: 'idle' | 'parsing' | 'uploading' | 'processing' | 'done' | 'error';
  totalRows: number;
  uploadedRows: number;
  processedRows: number;
  rejectedRows: number;
  errorMessage?: string;
}

const BATCH_SIZE = 500;

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

async function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
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

  const reset = useCallback(() => {
    setProgress({
      stage: 'idle',
      totalRows: 0,
      uploadedRows: 0,
      processedRows: 0,
      rejectedRows: 0,
    });
  }, []);

  const importFile = useCallback(async (file: File, fileType?: FileType) => {
    const type = fileType || detectFileType(file);

    setProgress({
      stage: 'parsing',
      totalRows: 0,
      uploadedRows: 0,
      processedRows: 0,
      rejectedRows: 0,
    });

    try {
      // Create import audit record
      const { data: audit, error: auditErr } = await supabase
        .from('import_audit')
        .insert({
          file_name: file.name,
          file_type: type,
          status: 'PROCESSING',
          total_rows: 0,
        })
        .select()
        .single();

      if (auditErr) {
        throw new Error(`Failed to create audit record: ${auditErr.message}`);
      }

      const auditId = (audit as ImportAudit).id;

      if (type === 'DSE_TRADE' || type === 'CSE_TRADE') {
        await importTradeFile(file, type, auditId);
      } else if (type === 'ADMIN_BALANCE') {
        await importAdminBalance(file, auditId);
      } else if (type === 'DEPOSIT_WITHDRAWAL') {
        await importDeposits(file, auditId);
      }
    } catch (err) {
      setProgress(p => ({
        ...p,
        stage: 'error',
        errorMessage: err instanceof Error ? err.message : String(err),
      }));
    }
  }, []);

  const importTradeFile = async (file: File, type: FileType, auditId: number) => {
    const text = await readFileAsText(file);

    let trades: RawTrade[];
    if (type === 'DSE_TRADE') {
      trades = parseDseXml(text, file.name);
    } else {
      trades = parseCseText(text, file.name);
    }

    setProgress(p => ({ ...p, totalRows: trades.length, stage: 'uploading' }));

    // Add audit ID and prepare for insert
    const rows = trades.map(t => ({
      ...t,
      import_audit_id: auditId,
    }));

    const { inserted, errors } = await batchInsert(
      'raw_trades',
      rows,
      (count) => setProgress(p => ({ ...p, uploadedRows: count })),
    );

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
        error_details: errors.length > 0 ? { errors } : null,
      })
      .eq('id', auditId);

    setProgress(p => ({
      ...p,
      stage: 'done',
      processedRows: inserted,
      rejectedRows: trades.length - inserted,
    }));
  };

  const importAdminBalance = async (file: File, auditId: number) => {
    const text = await readFileAsText(file);
    const parsed = parseAdminBalance(text);

    const totalRows = parsed.clients.length + parsed.holdings.length;
    setProgress(p => ({ ...p, totalRows, stage: 'uploading' }));

    let processedCount = 0;

    // Upsert clients
    for (let i = 0; i < parsed.clients.length; i += BATCH_SIZE) {
      const batch = parsed.clients.slice(i, i + BATCH_SIZE).map(c => ({
        bo_id: c.bo_id,
        client_code: c.client_code,
        name: c.name,
        account_type: c.account_type,
        commission_rate: c.commission_rate / 100, // Convert from percentage to decimal
        department: c.department,
        status: 'active',
      }));

      const { error } = await supabase
        .from('clients')
        .upsert(batch, { onConflict: 'bo_id' });

      if (error) {
        console.error('Client upsert error:', error);
      } else {
        processedCount += batch.length;
      }
      setProgress(p => ({ ...p, uploadedRows: processedCount }));
    }

    // For each client, create initial cash ledger entry if it doesn't exist
    for (const c of parsed.clients) {
      if (c.ledger_balance !== 0) {
        // Look up client_id
        const { data: clientData } = await supabase
          .from('clients')
          .select('client_id')
          .eq('bo_id', c.bo_id)
          .single();

        if (clientData) {
          // Check if opening balance already exists
          const { data: existing } = await supabase
            .from('cash_ledger')
            .select('id')
            .eq('client_id', clientData.client_id)
            .eq('type', 'OPENING_BALANCE')
            .limit(1);

          if (!existing || existing.length === 0) {
            await supabase.from('cash_ledger').insert({
              client_id: clientData.client_id,
              transaction_date: '2026-01-31',
              value_date: '2026-01-31',
              amount: c.ledger_balance,
              running_balance: c.ledger_balance,
              type: 'OPENING_BALANCE',
              narration: 'Opening balance from admin balance import',
            });
          }
        }
      }
    }

    // Upsert holdings — need to look up client_id and create security placeholders
    for (const h of parsed.holdings) {
      // Look up client
      const { data: clientData } = await supabase
        .from('clients')
        .select('client_id')
        .eq('bo_id', h.bo_id)
        .single();

      if (!clientData) continue;

      // Ensure security exists (placeholder if needed)
      await supabase
        .from('securities')
        .upsert(
          {
            isin: `PLACEHOLDER-${h.security_code}`,
            security_code: h.security_code,
            company_name: h.security_code,
            asset_class: 'EQ',
            status: 'active',
          },
          { onConflict: 'security_code', ignoreDuplicates: true }
        );

      // Get the ISIN (might be real or placeholder)
      const { data: secData } = await supabase
        .from('securities')
        .select('isin')
        .eq('security_code', h.security_code)
        .single();

      if (!secData) continue;

      await supabase
        .from('holdings')
        .upsert(
          {
            client_id: clientData.client_id,
            isin: secData.isin,
            quantity: h.quantity,
            average_cost: h.average_cost,
            total_invested: h.total_cost,
            realized_pl: 0,
            as_of_date: '2026-01-31',
          },
          { onConflict: 'client_id,isin' }
        );

      processedCount++;
      setProgress(p => ({ ...p, uploadedRows: processedCount }));
    }

    // Update audit
    await supabase
      .from('import_audit')
      .update({
        total_rows: totalRows,
        processed_rows: processedCount,
        rejected_rows: totalRows - processedCount,
        status: 'SUCCESS',
      })
      .eq('id', auditId);

    setProgress(p => ({
      ...p,
      stage: 'done',
      processedRows: processedCount,
      rejectedRows: totalRows - processedCount,
    }));
  };

  const importDeposits = async (file: File, auditId: number) => {
    const buffer = await readFileAsBuffer(file);
    const deposits = parseDepositXlsx(buffer, file.name);

    setProgress(p => ({ ...p, totalRows: deposits.length, stage: 'uploading' }));

    let processedCount = 0;

    for (const d of deposits) {
      // Look up client
      const { data: clientData } = await supabase
        .from('clients')
        .select('client_id')
        .or(`bo_id.eq.${d.bo_id},client_code.eq.${d.client_code}`)
        .single();

      if (!clientData) {
        continue;
      }

      // Get latest running balance
      const { data: lastEntry } = await supabase
        .from('cash_ledger')
        .select('running_balance')
        .eq('client_id', clientData.client_id)
        .order('id', { ascending: false })
        .limit(1)
        .single();

      const prevBalance = lastEntry?.running_balance ?? 0;
      const newBalance = prevBalance + d.amount;

      await supabase.from('cash_ledger').insert({
        client_id: clientData.client_id,
        transaction_date: d.transaction_date,
        value_date: d.transaction_date,
        amount: d.amount,
        running_balance: newBalance,
        type: d.type,
        reference: d.reference,
        narration: d.narration,
      });

      processedCount++;
      setProgress(p => ({ ...p, uploadedRows: processedCount }));
    }

    await supabase
      .from('import_audit')
      .update({
        total_rows: deposits.length,
        processed_rows: processedCount,
        rejected_rows: deposits.length - processedCount,
        status: processedCount === deposits.length ? 'SUCCESS' : 'PARTIAL',
      })
      .eq('id', auditId);

    setProgress(p => ({
      ...p,
      stage: 'done',
      processedRows: processedCount,
      rejectedRows: deposits.length - processedCount,
    }));
  };

  // Trigger trade processing edge function
  const processTrades = useCallback(async (importAuditId?: number) => {
    setProgress(p => ({ ...p, stage: 'processing' }));

    const { data, error } = await supabase.functions.invoke('process-trades', {
      body: { import_audit_id: importAuditId },
    });

    if (error) {
      setProgress(p => ({
        ...p,
        stage: 'error',
        errorMessage: error.message,
      }));
      return;
    }

    setProgress(p => ({
      ...p,
      stage: 'done',
      processedRows: data?.processed_count ?? 0,
      rejectedRows: data?.failed_count ?? 0,
    }));

    return data;
  }, []);

  return { progress, importFile, processTrades, reset, detectFileType };
}
