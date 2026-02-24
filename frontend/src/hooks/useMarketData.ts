import { useState, useEffect, useCallback } from 'react';
import { marketDb } from '@/lib/supabase-market';
import type { DailyStockEod, StockFundamental, HistoricalPrice } from '@/lib/types';

/**
 * Fetch the latest EOD prices for a list of symbols.
 * Returns the most recent date's data for each symbol.
 */
export function useLatestPrices(symbols: string[]) {
  const [prices, setPrices] = useState<Record<string, DailyStockEod>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (symbols.length === 0) {
      setPrices({});
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        // Fetch latest price for each symbol (most recent date)
        const { data, error: fetchErr } = await marketDb
          .from('daily_stock_eod')
          .select('*')
          .in('symbol', symbols)
          .order('date', { ascending: false })
          .limit(symbols.length * 2); // buffer for multiple dates

        if (fetchErr) throw new Error(fetchErr.message);
        if (cancelled) return;

        // Group by symbol, keep only the most recent entry
        const bySymbol: Record<string, DailyStockEod> = {};
        for (const row of (data ?? []) as DailyStockEod[]) {
          if (!bySymbol[row.symbol]) {
            bySymbol[row.symbol] = row;
          }
        }

        setPrices(bySymbol);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [symbols.join(',')]);

  return { prices, loading, error };
}

/**
 * Fetch all latest EOD prices (for the most recent trading date).
 */
export function useAllLatestPrices() {
  const [prices, setPrices] = useState<DailyStockEod[]>([]);
  const [latestDate, setLatestDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // First, find the latest date
      const { data: dateRow, error: dateErr } = await marketDb
        .from('daily_stock_eod')
        .select('date')
        .order('date', { ascending: false })
        .limit(1)
        .single();

      if (dateErr) throw new Error(dateErr.message);
      const date = (dateRow as DailyStockEod).date;
      setLatestDate(date);

      // Then fetch all prices for that date
      const { data, error: fetchErr } = await marketDb
        .from('daily_stock_eod')
        .select('*')
        .eq('date', date)
        .order('symbol');

      if (fetchErr) throw new Error(fetchErr.message);
      setPrices((data ?? []) as DailyStockEod[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { prices, latestDate, loading, error, refresh };
}

/**
 * Fetch stock fundamentals for a list of symbols or all.
 */
export function useFundamentals(symbols?: string[]) {
  const [fundamentals, setFundamentals] = useState<Record<string, StockFundamental>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        let query = marketDb
          .from('stock_fundamentals')
          .select('*');

        if (symbols && symbols.length > 0) {
          query = query.in('symbol', symbols);
        }

        const { data, error: fetchErr } = await query;
        if (fetchErr) throw new Error(fetchErr.message);
        if (cancelled) return;

        const bySymbol: Record<string, StockFundamental> = {};
        for (const row of (data ?? []) as StockFundamental[]) {
          bySymbol[row.symbol] = row;
        }

        setFundamentals(bySymbol);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [symbols?.join(',')]);

  return { fundamentals, loading, error };
}

/**
 * Fetch historical prices for a single symbol.
 */
export function useHistoricalPrices(symbol: string | null, days = 365) {
  const [history, setHistory] = useState<HistoricalPrice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!symbol) {
      setHistory([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const { data, error: fetchErr } = await marketDb
          .from('historical_prices')
          .select('*')
          .eq('symbol', symbol)
          .order('date', { ascending: true })
          .limit(days);

        if (fetchErr) throw new Error(fetchErr.message);
        if (cancelled) return;

        setHistory((data ?? []) as HistoricalPrice[]);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [symbol, days]);

  return { history, loading, error };
}

/**
 * One-shot function to fetch the current price for a single symbol.
 * Useful in components that don't need reactive updates.
 */
export async function fetchCurrentPrice(symbol: string): Promise<DailyStockEod | null> {
  const { data, error } = await marketDb
    .from('daily_stock_eod')
    .select('*')
    .eq('symbol', symbol)
    .order('date', { ascending: false })
    .limit(1)
    .single();

  if (error) return null;
  return data as DailyStockEod;
}

/**
 * One-shot function to fetch prices for multiple symbols.
 */
export async function fetchPricesForSymbols(
  symbols: string[],
): Promise<Record<string, DailyStockEod>> {
  if (symbols.length === 0) return {};

  // Get the latest date first
  const { data: dateRow } = await marketDb
    .from('daily_stock_eod')
    .select('date')
    .order('date', { ascending: false })
    .limit(1)
    .single();

  if (!dateRow) return {};

  const { data, error } = await marketDb
    .from('daily_stock_eod')
    .select('*')
    .in('symbol', symbols)
    .eq('date', (dateRow as DailyStockEod).date);

  if (error || !data) return {};

  const result: Record<string, DailyStockEod> = {};
  for (const row of data as DailyStockEod[]) {
    result[row.symbol] = row;
  }
  return result;
}
