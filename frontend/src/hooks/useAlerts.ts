import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { MarginAlert } from '@/lib/types';

interface AlertFilters {
  resolved?: boolean | null;
  alertType?: string;
  page?: number;
}

const PAGE_SIZE = 25;

export function useMarginAlerts(filters: AlertFilters = {}) {
  const { resolved = null, alertType, page = 0 } = filters;
  const [alerts, setAlerts] = useState<MarginAlert[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      let query = supabase
        .from('margin_alerts')
        .select('*, client:clients(*)', { count: 'exact' })
        .order('alert_date', { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (resolved !== null) {
        query = query.eq('resolved', resolved);
      }
      if (alertType) {
        query = query.eq('alert_type', alertType);
      }

      const { data, error: fetchErr, count } = await query;
      if (fetchErr) throw new Error(fetchErr.message);
      setAlerts((data ?? []) as MarginAlert[]);
      setTotalCount(count ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [resolved, alertType, page]);

  useEffect(() => { refresh(); }, [refresh]);

  return { alerts, totalCount, loading, error, refresh, pageSize: PAGE_SIZE };
}

export function useResolveAlert() {
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolve = async (alertId: number) => {
    setResolving(true);
    setError(null);
    try {
      const { error: updateErr } = await supabase
        .from('margin_alerts')
        .update({
          resolved: true,
          resolved_date: new Date().toISOString(),
        })
        .eq('id', alertId);

      if (updateErr) throw new Error(updateErr.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setResolving(false);
    }
  };

  return { resolve, resolving, error };
}
