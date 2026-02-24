import Papa from 'papaparse';
import { parseFormattedNumber } from '@/lib/utils';
import type { ParsedAdminBalance } from '@/lib/types';

interface CsvRow {
  'Investor Code': string;
  'BOID': string;
  'Instrument': string;
  'Investor Name ': string; // Note: trailing space in header
  'TotalStock': string;
  'Saleable': string;
  'AvgCost': string;
  'Total Cost': string;
  'Total M.V.': string;
  'Ledger Balance': string;
  'Matured Balance': string;
  'Receiveable Sales': string;
  'Cheque In Tran/Hand': string;
  'RM': string;
  'RM ID': string;
  'RM Email': string;
  'Department': string;
  'Commission Rate': string;
  'ChargeRate': string;
  'Account Type': string;
}

/**
 * Parse admin balance CSV file.
 * Each row is one client+instrument combination. Rows with empty Instrument are cash-only.
 * Client info is repeated across rows for the same client.
 */
export function parseAdminBalance(csvText: string): ParsedAdminBalance {
  const result = Papa.parse<CsvRow>(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  if (result.errors.length > 0) {
    console.warn('CSV parse warnings:', result.errors);
  }

  const clientMap = new Map<string, ParsedAdminBalance['clients'][0]>();
  const holdings: ParsedAdminBalance['holdings'] = [];

  for (const row of result.data) {
    const investorCode = row['Investor Code']?.trim();
    const boId = row['BOID']?.trim();
    if (!investorCode || !boId) continue;

    // Extract/update client info (take from first row seen for each client)
    if (!clientMap.has(investorCode)) {
      const nameKey = Object.keys(row).find(k => k.trim() === 'Investor Name') || 'Investor Name ';
      clientMap.set(investorCode, {
        bo_id: boId,
        client_code: investorCode,
        name: (row[nameKey as keyof CsvRow] || '').trim(),
        account_type: row['Account Type']?.trim() === 'Margin' ? 'Margin' : 'Cash',
        commission_rate: parseFloat(row['Commission Rate'] || '0') || 0,
        rm_name: row['RM']?.trim() || null,
        rm_id: row['RM ID']?.trim() || null,
        rm_email: row['RM Email']?.trim() || null,
        department: row['Department']?.trim() || null,
        ledger_balance: parseFormattedNumber(row['Ledger Balance']),
        matured_balance: parseFormattedNumber(row['Matured Balance']),
      });
    }

    // Extract holding if instrument is present
    const instrument = row['Instrument']?.trim();
    if (instrument) {
      const qty = parseFormattedNumber(row['TotalStock']);
      const saleable = parseFormattedNumber(row['Saleable']);
      const avgCost = parseFormattedNumber(row['AvgCost']);
      const totalCost = parseFormattedNumber(row['Total Cost']);
      const marketValue = parseFormattedNumber(row['Total M.V.']);

      if (qty > 0) {
        holdings.push({
          client_code: investorCode,
          bo_id: boId,
          security_code: instrument,
          quantity: qty,
          saleable,
          average_cost: avgCost,
          total_cost: totalCost,
          market_value: marketValue,
        });
      }
    }
  }

  return {
    clients: Array.from(clientMap.values()),
    holdings,
  };
}
