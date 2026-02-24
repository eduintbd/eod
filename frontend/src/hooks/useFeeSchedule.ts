import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { FeeScheduleEntry } from '@/lib/types';

export function useFeeSchedule() {
  const [fees, setFees] = useState<FeeScheduleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchErr } = await supabase
        .from('fee_schedule')
        .select('*')
        .order('fee_type');

      if (fetchErr) throw new Error(fetchErr.message);
      setFees((data ?? []) as FeeScheduleEntry[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { fees, loading, error, refresh };
}

export function useUpdateFee() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateFee = async (id: number, updates: Partial<FeeScheduleEntry>) => {
    setSaving(true);
    setError(null);
    try {
      const { error: updateErr } = await supabase
        .from('fee_schedule')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (updateErr) throw new Error(updateErr.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const addFee = async (entry: Omit<FeeScheduleEntry, 'id' | 'created_at' | 'updated_at'>) => {
    setSaving(true);
    setError(null);
    try {
      const { error: insertErr } = await supabase
        .from('fee_schedule')
        .insert(entry);

      if (insertErr) throw new Error(insertErr.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      setSaving(false);
    }
  };

  return { updateFee, addFee, saving, error };
}
