import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import type { MarginAccount } from '@/lib/types';

export function useMarginAccounts(statusFilter?: string) {
  const [accounts, setAccounts] = useState<MarginAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        let query = supabase
          .from('margin_accounts')
          .select('*, client:clients(*)')
          .order('margin_ratio', { ascending: true });

        if (statusFilter && statusFilter !== 'ALL') {
          query = query.eq('maintenance_status', statusFilter);
        }

        const { data, error: fetchErr } = await query;
        if (fetchErr) throw new Error(fetchErr.message);
        if (!cancelled) setAccounts((data ?? []) as MarginAccount[]);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [statusFilter]);

  return { accounts, loading, error };
}

export function useMarginAccount(clientId: string | undefined) {
  const [account, setAccount] = useState<MarginAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId) {
      setAccount(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const { data, error: fetchErr } = await supabase
          .from('margin_accounts')
          .select('*, client:clients(*)')
          .eq('client_id', clientId)
          .maybeSingle();

        if (fetchErr) throw new Error(fetchErr.message);
        if (!cancelled) setAccount(data as MarginAccount | null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [clientId]);

  return { account, loading, error };
}
