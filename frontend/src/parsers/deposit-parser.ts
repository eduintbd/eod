import * as XLSX from 'xlsx';
import type { ParsedDeposit } from '@/lib/types';

/**
 * Parse deposit/withdrawal Excel file.
 *
 * Actual file format (Deposit Withdrawal 01.02.2026.xlsx):
 * Columns: SL | Inv. Code | Inv. Name | Tr. Type | Tr. Mode | Cheque No |
 *          BankName | Bank Br.Name | Descriptions | Debit | Credit
 *
 * - Tr. Type: "Receipt" (deposit) or "Payment" (withdrawal)
 * - Amount is split into Debit (outflow) and Credit (inflow) columns
 * - File may have metadata rows at the top (e.g. "Date : 01-Feb-2026")
 */
export function parseDepositXlsx(buffer: ArrayBuffer, _fileName: string): ParsedDeposit[] {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  if (workbook.SheetNames.length === 0) throw new Error('No sheets found in workbook');

  // Parse ALL sheets and combine results (deposits may be on one sheet, withdrawals on another)
  const allDeposits: ParsedDeposit[] = [];
  for (const sheetName of workbook.SheetNames) {
    const parsed = parseSheet(workbook.Sheets[sheetName], sheetName);
    allDeposits.push(...parsed);
  }

  if (allDeposits.length === 0) throw new Error('No data rows found in any sheet');
  return allDeposits;
}

function parseSheet(sheet: XLSX.WorkSheet, sheetName: string): ParsedDeposit[] {
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  if (rows.length === 0) return [];

  // Infer type override from sheet name (e.g. "Receipt", "Payment")
  const sn = sheetName.toLowerCase();
  const sheetTypeOverride =
    (sn.includes('receipt') || sn.includes('deposit')) ? 'DEPOSIT' :
    (sn.includes('payment') || sn.includes('withdraw')) ? 'WITHDRAWAL' :
    null;

  // Auto-detect column mapping from first row keys
  const keys = Object.keys(rows[0]);
  const findCol = (...candidates: string[]): string | undefined =>
    keys.find(k => candidates.some(c => k.toLowerCase().includes(c.toLowerCase())));

  const boIdCol = findCol('BOID', 'BO ID', 'bo_id', 'Beneficiary');
  const clientCodeCol = findCol('Inv. Code', 'Inv.Code', 'InvCode', 'ClientCode', 'Client Code',
    'client_code', 'Investor Code', 'Account');
  const dateCol = findCol('Date', 'TransactionDate', 'Transaction Date', 'Txn Date');
  const singleAmountCol = findCol('Amount', 'Amt');
  const debitCol = findCol('Debit');
  const creditCol = findCol('Credit');
  const typeCol = findCol('Tr. Type', 'Tr.Type', 'Type', 'Transaction Type', 'Txn Type', 'Category');
  const refCol = findCol('Cheque No', 'Cheque', 'Reference', 'Ref', 'Transfer ID');
  const narrationCol = findCol('Descriptions', 'Description', 'Narration', 'Remarks', 'Memo');

  const hasSeparateDebitCredit = !!(debitCol && creditCol);

  const deposits: ParsedDeposit[] = [];
  const slCol = keys.find(k => k.toLowerCase() === 'sl');

  for (const row of rows) {
    // Skip footer/summary rows: SL must be a number (serial 1,2,3...)
    if (slCol) {
      const sl = row[slCol];
      if (sl != null && typeof sl !== 'number') continue;
    }

    const getVal = (col: string | undefined): string | null => {
      if (!col) return null;
      const v = row[col];
      if (v == null) return null;
      return String(v).trim();
    };

    const getNum = (col: string | undefined): number => {
      if (!col) return 0;
      const v = row[col];
      if (v == null) return 0;
      const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
      return isNaN(n) ? 0 : n;
    };

    // Compute amount from either single Amount column or Debit/Credit pair
    let amount: number;
    if (hasSeparateDebitCredit) {
      const debit = getNum(debitCol);
      const credit = getNum(creditCol);
      // Credit = money in (positive), Debit = money out (negative)
      amount = credit - debit;
    } else {
      amount = getNum(singleAmountCol);
    }

    if (amount === 0) continue;

    // Parse date — may come from column or be empty (will use asOfDate from import)
    let transDate = getVal(dateCol) || '';
    if (transDate.includes('T')) {
      transDate = transDate.split('T')[0];
    }
    if (!transDate && dateCol) {
      const raw = row[dateCol];
      if (raw instanceof Date) {
        transDate = raw.toISOString().split('T')[0];
      }
    }

    // Determine type from Tr. Type column or infer from amount
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

    // Ensure withdrawal amounts are negative
    if (type === 'WITHDRAWAL' && amount > 0) {
      amount = -amount;
    }

    const clientCode = getVal(clientCodeCol);
    const boId = getVal(boIdCol);

    // Skip rows without any client identifier (metadata rows like "Date : 01-Feb-2026")
    if (!clientCode && !boId) continue;

    deposits.push({
      bo_id: boId,
      client_code: clientCode,
      transaction_date: transDate,
      amount,
      type,
      reference: getVal(refCol),
      narration: getVal(narrationCol),
    });
  }

  return deposits;
}
