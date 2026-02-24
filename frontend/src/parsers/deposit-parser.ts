import * as XLSX from 'xlsx';
import type { ParsedDeposit } from '@/lib/types';

/**
 * Parse deposit/withdrawal Excel file.
 * Expected columns: BOID/ClientCode, TransactionDate, Amount, Type, Reference, Narration
 * Column names may vary — we try common variants.
 */
export function parseDepositXlsx(buffer: ArrayBuffer, _fileName: string): ParsedDeposit[] {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('No sheets found in workbook');

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });

  if (rows.length === 0) throw new Error('No data rows found in sheet');

  // Auto-detect column mapping from first row keys
  const keys = Object.keys(rows[0]);
  const findCol = (...candidates: string[]): string | undefined =>
    keys.find(k => candidates.some(c => k.toLowerCase().includes(c.toLowerCase())));

  const boIdCol = findCol('BOID', 'BO ID', 'bo_id', 'Beneficiary');
  const clientCodeCol = findCol('ClientCode', 'Client Code', 'client_code', 'Investor Code', 'Account');
  const dateCol = findCol('Date', 'TransactionDate', 'Transaction Date', 'Txn Date');
  const amountCol = findCol('Amount', 'Amt');
  const typeCol = findCol('Type', 'Transaction Type', 'Txn Type', 'Category');
  const refCol = findCol('Reference', 'Ref', 'Cheque', 'Transfer ID');
  const narrationCol = findCol('Narration', 'Description', 'Remarks', 'Memo');

  const deposits: ParsedDeposit[] = [];

  for (const row of rows) {
    const getVal = (col: string | undefined): string | null => {
      if (!col) return null;
      const v = row[col];
      if (v == null) return null;
      return String(v).trim();
    };

    const amountStr = getVal(amountCol);
    const amount = amountStr ? parseFloat(amountStr.replace(/,/g, '')) : 0;
    if (isNaN(amount) || amount === 0) continue;

    let transDate = getVal(dateCol) || new Date().toISOString().split('T')[0];
    // If it's a Date object serialized as string, normalize
    if (transDate.includes('T')) {
      transDate = transDate.split('T')[0];
    }

    // Infer type from amount sign if not provided
    let type = getVal(typeCol);
    if (!type) {
      type = amount >= 0 ? 'DEPOSIT' : 'WITHDRAWAL';
    }

    deposits.push({
      bo_id: getVal(boIdCol),
      client_code: getVal(clientCodeCol),
      transaction_date: transDate,
      amount,
      type: type.toUpperCase(),
      reference: getVal(refCol),
      narration: getVal(narrationCol),
    });
  }

  return deposits;
}
