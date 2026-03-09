import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { CommissionRateChange } from '@/lib/types';

export function useCommissionRateHistory(clientId: string | undefined) {
  const [changes, setChanges] = useState<CommissionRateChange[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchErr } = await supabase
        .from('commission_rate_changes')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false });

      if (fetchErr) throw new Error(fetchErr.message);
      setChanges((data ?? []) as CommissionRateChange[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { refresh(); }, [refresh]);

  return { changes, loading, error, refresh };
}

export function useChangeCommissionRate() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changeRate = async (params: {
    p_client_id: string;
    p_new_rate: number;
    p_effective_date: string;
    p_reason?: string;
  }) => {
    setSaving(true);
    setError(null);
    try {
      const { error: rpcErr } = await supabase.rpc('change_commission_rate', params);
      if (rpcErr) throw new Error(rpcErr.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      setSaving(false);
    }
  };

  return { changeRate, saving, error };
}
