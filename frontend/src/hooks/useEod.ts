import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { EodRun, EodPreflight } from '@/lib/types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export interface EodProgress {
  status: 'idle' | 'preflight' | 'running' | 'completed' | 'error';
  clientsProcessed: number;
  snapshotsCreated: number;
  alertsGenerated: number;
  totalClients: number;
  currentBatch: number;
  done: boolean;
  error: string | null;
  errors: Array<{ client_id: string; error: string }>;
}

export function useEod() {
  const [preflight, setPreflight] = useState<EodPreflight | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [progress, setProgress] = useState<EodProgress>({
    status: 'idle',
    clientsProcessed: 0,
    snapshotsCreated: 0,
    alertsGenerated: 0,
    totalClients: 0,
    currentBatch: 0,
    done: false,
    error: null,
    errors: [],
  });
  const [history, setHistory] = useState<EodRun[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const fetchPreflight = useCallback(async (date: string) => {
    setPreflightLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_eod_preflight', { p_date: date });
      if (error) throw new Error(error.message);
      setPreflight(data as unknown as EodPreflight);
      return data as unknown as EodPreflight;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPreflight(null);
      throw new Error(msg);
    } finally {
      setPreflightLoading(false);
    }
  }, []);

  const runEod = useCallback(async (date: string, force = false) => {
    setProgress({
      status: 'running',
      clientsProcessed: 0,
      snapshotsCreated: 0,
      alertsGenerated: 0,
      totalClients: preflight?.total_clients ?? 0,
      currentBatch: 0,
      done: false,
      error: null,
      errors: [],
    });

    let offset = 0;
    let totalProcessed = 0;
    let totalSnapshots = 0;
    let totalAlerts = 0;
    let batchNum = 0;
    const allErrors: Array<{ client_id: string; error: string }> = [];

    try {
      // Get auth token for edge function call
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token ?? SUPABASE_ANON_KEY;

      while (true) {
        batchNum++;
        const res = await fetch(`${SUPABASE_URL}/functions/v1/run-eod`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'apikey': SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ eod_date: date, force, offset }),
        });

        const result = await res.json();

        if (!res.ok) {
          throw new Error(result.error || `HTTP ${res.status}`);
        }

        totalProcessed += result.clients_processed ?? 0;
        totalSnapshots += result.snapshots_created ?? 0;
        totalAlerts += result.margin_alerts_generated ?? 0;
        if (result.errors) allErrors.push(...result.errors);

        setProgress({
          status: 'running',
          clientsProcessed: totalProcessed,
          snapshotsCreated: totalSnapshots,
          alertsGenerated: totalAlerts,
          totalClients: preflight?.total_clients ?? 0,
          currentBatch: batchNum,
          done: result.done,
          error: null,
          errors: allErrors,
        });

        if (result.done) break;
        offset += result.batch_size ?? 200;
      }

      setProgress(prev => ({ ...prev, status: 'completed', done: true }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setProgress(prev => ({ ...prev, status: 'error', error: msg }));
      throw err;
    }
  }, [preflight]);

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const { data, error } = await supabase
        .from('eod_runs')
        .select('*')
        .order('eod_date', { ascending: false })
        .limit(20);

      if (error) throw new Error(error.message);
      setHistory((data ?? []) as EodRun[]);
    } catch (_) {
      // Ignore — table may not exist yet
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const resetProgress = useCallback(() => {
    setProgress({
      status: 'idle',
      clientsProcessed: 0,
      snapshotsCreated: 0,
      alertsGenerated: 0,
      totalClients: 0,
      currentBatch: 0,
      done: false,
      error: null,
      errors: [],
    });
    setPreflight(null);
  }, []);

  return {
    preflight,
    preflightLoading,
    fetchPreflight,
    progress,
    runEod,
    resetProgress,
    history,
    historyLoading,
    fetchHistory,
  };
}
