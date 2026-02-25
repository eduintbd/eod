import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { MarginConfigEntry } from '@/lib/types';

export function useMarginConfig() {
  const [configs, setConfigs] = useState<MarginConfigEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchErr } = await supabase
        .from('margin_config')
        .select('*')
        .order('parameter_name');

      if (fetchErr) throw new Error(fetchErr.message);
      setConfigs((data ?? []) as MarginConfigEntry[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { configs, loading, error, refresh };
}

export function useUpdateMarginConfig() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateConfig = async (id: number, updates: Partial<MarginConfigEntry>) => {
    setSaving(true);
    setError(null);
    try {
      const { error: updateErr } = await supabase
        .from('margin_config')
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

  return { updateConfig, saving, error };
}
