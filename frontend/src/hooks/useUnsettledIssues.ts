import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

export interface UnsettledIssue {
  eventDate: string;
  clientId: string;
  clientCode: string;
  clientName: string;
  accountType: string;
  instruments: string;
  amount: number;
  loanRatio: string;
  rmName: string;
  nonComplianceType: string;
  remarks: string;
  hodName: string;
  department: string;
  rmFrequency: number;
  unsettledDays: number;
  disciplinaryMeasure: string;
}

export interface UnsettledFilters {
  department?: string;
  rmName?: string;
  nonComplianceType?: string;
  accountType?: string;
}

interface NegativeBalanceRow {
  client_id: string;
  running_balance: number;
  transaction_date: string;
  entry_type: string;
  reference: string | null;
  narration: string | null;
  ledger_id: number;
}

interface CashLedgerRow {
  id: number;
  client_id: string;
  transaction_date: string;
  amount: number;
  running_balance: number;
  type: string;
  reference: string | null;
  narration: string | null;
}

function getDisciplinaryMeasure(freq: number): string {
  if (freq >= 4) return 'A/C not to be counted in performance';
  if (freq >= 3) return '2nd Meeting with HoD & ICCD';
  if (freq >= 2) return '1st Meeting with HoD & ICCD';
  return 'ICCD Notice';
}

function daysBetween(dateStr: string, now: Date): number {
  const d = new Date(dateStr);
  const diff = now.getTime() - d.getTime();
  return Math.max(1, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

export function useUnsettledIssues(filters: UnsettledFilters = {}) {
  const [issues, setIssues] = useState<UnsettledIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Step 1: Get clients with negative balances via RPC (paginated)
      const allNegRows: NegativeBalanceRow[] = [];
      const RPC_PAGE = 1000;
      let rpcOffset = 0;

      while (true) {
        const { data, error: rpcErr } = await supabase
          .rpc('get_negative_balance_clients')
          .range(rpcOffset, rpcOffset + RPC_PAGE - 1);

        if (rpcErr) throw new Error(rpcErr.message);
        if (!data || data.length === 0) break;

        allNegRows.push(...(data as NegativeBalanceRow[]));
        rpcOffset += RPC_PAGE;
        if (data.length < RPC_PAGE) break;
      }

      if (allNegRows.length === 0) {
        setIssues([]);
        return;
      }

      const negRows = allNegRows;
      const clientIds = negRows.map(r => r.client_id);

      // Step 2: Get client details
      const clientMap = new Map<string, {
        client_code: string | null;
        name: string | null;
        department: string | null;
        rm_id: string | null;
        account_type: string | null;
      }>();

      for (let i = 0; i < clientIds.length; i += 100) {
        const batch = clientIds.slice(i, i + 100);
        const { data } = await supabase
          .from('clients')
          .select('client_id, client_code, name, department, rm_id, account_type')
          .in('client_id', batch);
        for (const c of data || []) {
          clientMap.set(c.client_id, c);
        }
      }

      // Step 3: Get RM names from app_users
      const rmIds = [...new Set(
        [...clientMap.values()].map(c => c.rm_id).filter(Boolean) as string[]
      )];
      const rmMap = new Map<string, { full_name: string | null; department: string | null }>();

      if (rmIds.length > 0) {
        for (let i = 0; i < rmIds.length; i += 100) {
          const batch = rmIds.slice(i, i + 100);
          const { data } = await supabase
            .from('app_users')
            .select('id, full_name, department')
            .in('id', batch);
          for (const rm of data || []) {
            rmMap.set(rm.id, rm);
          }
        }
      }

      // Step 4: Get cash_ledger history ONLY for clients whose latest entry
      // is a trade/withdrawal (not OPENING_BALANCE) to trace when balance went negative.
      // For OPENING_BALANCE entries, the event date is the transaction_date itself.
      const traceClientIds = negRows
        .filter(r => r.entry_type !== 'OPENING_BALANCE')
        .map(r => r.client_id);

      const historyMap = new Map<string, CashLedgerRow[]>();

      for (let i = 0; i < traceClientIds.length; i += 30) {
        const batch = traceClientIds.slice(i, i + 30);
        const { data } = await supabase
          .from('cash_ledger')
          .select('id, client_id, transaction_date, amount, running_balance, type, reference, narration')
          .in('client_id', batch)
          .order('id', { ascending: false })
          .limit(3000);

        for (const row of (data || []) as CashLedgerRow[]) {
          if (!historyMap.has(row.client_id)) {
            historyMap.set(row.client_id, []);
          }
          historyMap.get(row.client_id)!.push(row);
        }
      }

      // Step 5: Get margin data for loan ratios
      const marginMap = new Map<string, { loan_balance: number; margin_ratio: number }>();
      for (let i = 0; i < clientIds.length; i += 100) {
        const batch = clientIds.slice(i, i + 100);
        const { data } = await supabase
          .from('margin_accounts')
          .select('client_id, loan_balance, margin_ratio')
          .in('client_id', batch);
        for (const m of data || []) {
          marginMap.set(m.client_id, m);
        }
      }

      // Step 6: Build issues list
      const today = new Date();
      const builtIssues: UnsettledIssue[] = [];

      for (const neg of negRows) {
        const client = clientMap.get(neg.client_id);
        if (!client) continue;

        let eventDate = neg.transaction_date;
        let triggeringType = neg.entry_type;
        let triggeringNarration = neg.narration || '';

        // For non-OPENING_BALANCE entries, trace history to find when balance went negative
        if (neg.entry_type !== 'OPENING_BALANCE') {
          const history = historyMap.get(neg.client_id) || [];
          for (let i = 0; i < history.length; i++) {
            if (history[i].running_balance >= 0) {
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
        }

        // Determine non-compliance type
        let nonComplianceType = 'Negative Balance';
        if (triggeringType === 'BUY_TRADE') {
          nonComplianceType = 'Negative Balance-OMS Trade';
        }

        // Extract instrument from narration (format: "BUY 100 SYMBOL @ 50")
        let instruments = 'NA';
        if (triggeringNarration) {
          const match = triggeringNarration.match(/^(?:BUY|SELL)\s+\d+\s+(\S+)/);
          if (match) instruments = match[1];
        }

        // RM info
        const rm = client.rm_id ? rmMap.get(client.rm_id) : null;
        const rmName = rm?.full_name || 'N/A';
        const hodName = rm?.department ? `HoD - ${rm.department}` : 'N/A';

        // Loan ratio
        const margin = marginMap.get(neg.client_id);
        const loanRatio = margin
          ? `1:${margin.margin_ratio?.toFixed(2) || '0.00'}`
          : 'N/A';

        builtIssues.push({
          eventDate,
          clientId: neg.client_id,
          clientCode: client.client_code || '',
          clientName: client.name || '',
          accountType: client.account_type || 'N/A',
          instruments,
          amount: neg.running_balance,
          loanRatio,
          rmName,
          nonComplianceType,
          remarks: '',
          hodName,
          department: client.department || 'N/A',
          rmFrequency: 0,
          unsettledDays: daysBetween(eventDate, today),
          disciplinaryMeasure: '',
        });
      }

      // Step 7: Compute RM frequency and disciplinary measures
      // Only compute frequency for known RMs (not N/A)
      const rmFreqMap = new Map<string, number>();
      for (const issue of builtIssues) {
        if (issue.rmName !== 'N/A') {
          rmFreqMap.set(issue.rmName, (rmFreqMap.get(issue.rmName) || 0) + 1);
        }
      }
      for (const issue of builtIssues) {
        if (issue.rmName !== 'N/A') {
          issue.rmFrequency = rmFreqMap.get(issue.rmName) || 0;
          issue.disciplinaryMeasure = getDisciplinaryMeasure(issue.rmFrequency);
        } else {
          issue.rmFrequency = 0;
          issue.disciplinaryMeasure = 'N/A';
        }
      }

      // Sort by amount ascending (most negative first)
      builtIssues.sort((a, b) => a.amount - b.amount);

      setIssues(builtIssues);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Apply client-side filters
  const filtered = issues.filter(issue => {
    if (filters.department && issue.department !== filters.department) return false;
    if (filters.rmName && issue.rmName !== filters.rmName) return false;
    if (filters.nonComplianceType && issue.nonComplianceType !== filters.nonComplianceType) return false;
    if (filters.accountType && issue.accountType !== filters.accountType) return false;
    return true;
  });

  // Compute summary stats
  const summary = {
    totalAccounts: filtered.length,
    totalNegativeAmount: filtered.reduce((sum, i) => sum + i.amount, 0),
    byType: filtered.reduce((acc, i) => {
      acc[i.nonComplianceType] = (acc[i.nonComplianceType] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    uniqueRMs: new Set(filtered.map(i => i.rmName).filter(n => n !== 'N/A')).size,
  };

  // Extract unique filter options
  const filterOptions = {
    departments: [...new Set(issues.map(i => i.department).filter(d => d !== 'N/A'))].sort(),
    rmNames: [...new Set(issues.map(i => i.rmName).filter(n => n !== 'N/A'))].sort(),
    nonComplianceTypes: [...new Set(issues.map(i => i.nonComplianceType))].sort(),
    accountTypes: [...new Set(issues.map(i => i.accountType).filter(t => t !== 'N/A'))].sort(),
  };

  return { issues: filtered, allIssues: issues, summary, filterOptions, loading, error, refresh };
}
