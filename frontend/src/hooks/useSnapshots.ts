import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import type { DailySnapshot } from '@/lib/types';

export function useDailySnapshots(date?: string) {
  const [snapshots, setSnapshots] = useState<DailySnapshot[]>([]);
  const [snapshotDate, setSnapshotDate] = useState<string | null>(date ?? null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        if (date) {
          // Fetch snapshots for the specified date
          const { data, error: fetchErr } = await supabase
            .from('daily_snapshots')
            .select('*, client:clients(*)')
            .eq('snapshot_date', date)
            .order('net_equity', { ascending: false });

          if (fetchErr) throw new Error(fetchErr.message);
          if (!cancelled) {
            setSnapshots((data ?? []) as DailySnapshot[]);
            setSnapshotDate(date);
          }
        } else {
          // Find the latest date first
          const { data: latest, error: dateErr } = await supabase
            .from('daily_snapshots')
            .select('snapshot_date')
            .order('snapshot_date', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (dateErr) throw new Error(dateErr.message);

          if (!latest) {
            if (!cancelled) {
              setSnapshots([]);
              setSnapshotDate(null);
            }
            return;
          }

          const latestDate = (latest as DailySnapshot).snapshot_date;

          const { data, error: fetchErr } = await supabase
            .from('daily_snapshots')
            .select('*, client:clients(*)')
            .eq('snapshot_date', latestDate)
            .order('net_equity', { ascending: false });

          if (fetchErr) throw new Error(fetchErr.message);
          if (!cancelled) {
            setSnapshots((data ?? []) as DailySnapshot[]);
            setSnapshotDate(latestDate);
          }
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [date]);

  return { snapshots, snapshotDate, loading, error };
}

export function useClientSnapshots(clientId: string | undefined, limit = 30) {
  const [snapshots, setSnapshots] = useState<DailySnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId) {
      setSnapshots([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const { data, error: fetchErr } = await supabase
          .from('daily_snapshots')
          .select('*')
          .eq('client_id', clientId)
          .order('snapshot_date', { ascending: false })
          .limit(limit);

        if (fetchErr) throw new Error(fetchErr.message);
        if (!cancelled) setSnapshots((data ?? []) as DailySnapshot[]);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [clientId, limit]);

  return { snapshots, loading, error };
}
