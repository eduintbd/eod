import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { MarginAccount } from '@/lib/types';

export interface NegativeEquityAccount {
  clientId: string;
  clientCode: string;
  clientName: string;
  accountType: string;
  department: string;
  loanBalance: number;
  totalPortfolioValue: number;
  clientEquity: number;
  provisionAmount: number;
  marginRatio: number;
  maintenanceStatus: string;
  appliedRatio: string;
  marginCallCount: number;
  deadline: string | null;
}

export interface NegativeEquitySummary {
  totalAccounts: number;
  totalProvision: number;
  byStatus: Record<string, number>;
  byAccountType: Record<string, number>;
}

export interface NegativeEquityFilters {
  accountType?: string;
  department?: string;
}

export function useNegativeEquity() {
  const [accounts, setAccounts] = useState<NegativeEquityAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: fetchErr } = await supabase
        .from('margin_accounts')
        .select('*, client:clients(client_id, client_code, name, department, account_type)')
        .lt('client_equity', 0)
        .order('client_equity', { ascending: true });

      if (fetchErr) throw new Error(fetchErr.message);

      const rows = (data ?? []) as (MarginAccount & {
        client: {
          client_id: string;
          client_code: string | null;
          name: string | null;
          department: string | null;
          account_type: string | null;
        } | null;
      })[];

      const built: NegativeEquityAccount[] = rows.map(r => ({
        clientId: r.client_id,
        clientCode: r.client?.client_code || '',
        clientName: r.client?.name || '',
        accountType: r.client?.account_type || 'N/A',
        department: r.client?.department || 'N/A',
        loanBalance: r.loan_balance ?? 0,
        totalPortfolioValue: r.total_portfolio_value ?? r.portfolio_value ?? 0,
        clientEquity: r.client_equity ?? 0,
        provisionAmount: Math.abs(r.client_equity ?? 0),
        marginRatio: r.margin_ratio ?? 0,
        maintenanceStatus: r.maintenance_status ?? 'NORMAL',
        appliedRatio: r.applied_ratio || 'N/A',
        marginCallCount: r.margin_call_count ?? 0,
        deadline: r.margin_call_deadline || null,
      }));

      setAccounts(built);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Extract filter options from all accounts (before filtering)
  const filterOptions = {
    departments: [...new Set(accounts.map(a => a.department).filter(d => d !== 'N/A'))].sort(),
    accountTypes: [...new Set(accounts.map(a => a.accountType).filter(t => t !== 'N/A'))].sort(),
  };

  return { accounts, filterOptions, loading, error, refresh };
}

/** Apply client-side filters and compute summary */
export function useFilteredNegativeEquity(
  accounts: NegativeEquityAccount[],
  filters: NegativeEquityFilters,
) {
  const filtered = accounts.filter(a => {
    if (filters.accountType && a.accountType !== filters.accountType) return false;
    if (filters.department && a.department !== filters.department) return false;
    return true;
  });

  const summary: NegativeEquitySummary = {
    totalAccounts: filtered.length,
    totalProvision: filtered.reduce((sum, a) => sum + a.provisionAmount, 0),
    byStatus: filtered.reduce((acc, a) => {
      acc[a.maintenanceStatus] = (acc[a.maintenanceStatus] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    byAccountType: filtered.reduce((acc, a) => {
      acc[a.accountType] = (acc[a.accountType] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
  };

  return { filtered, summary };
}
