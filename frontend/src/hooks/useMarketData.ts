import { useState, useEffect, useCallback } from 'react';
import { marketDb, marketPublicDb } from '@/lib/supabase-market';
import type { DailyStockEod, StockFundamental, HistoricalPrice } from '@/lib/types';

/**
 * Fetch the latest prices for a list of symbols from public.price_history.
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
        const { data, error: fetchErr } = await marketPublicDb
          .from('price_history')
          .select('id, symbol, trade_date, close, volume')
          .in('symbol', symbols)
          .order('trade_date', { ascending: false })
          .limit(symbols.length * 2);

        if (fetchErr) throw new Error(fetchErr.message);
        if (cancelled) return;

        const bySymbol: Record<string, DailyStockEod> = {};
        for (const row of data ?? []) {
          const sym = row.symbol ?? '';
          if (!bySymbol[sym]) {
            bySymbol[sym] = {
              id: String(row.id ?? sym),
              symbol: sym,
              date: row.trade_date ?? '',
              close: row.close ?? 0,
              volume: row.volume ?? 0,
              total_shares: null,
              category: null,
              sector: null,
              pe: null,
              created_at: '',
            };
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
 * Fetch all latest prices from public.price_history (1.18M rows, OHLCV since 2012).
 * This is the canonical price source in ucb csm.
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
      // Find the latest date in public.price_history
      const { data: dateRow, error: dateErr } = await marketPublicDb
        .from('price_history')
        .select('trade_date')
        .order('trade_date', { ascending: false })
        .limit(1)
        .single();

      if (dateErr) throw new Error(dateErr.message);
      const date = dateRow.trade_date as string;
      setLatestDate(date);

      // Fetch all prices for that date
      const { data: phData, error: phErr } = await marketPublicDb
        .from('price_history')
        .select('id, symbol, trade_date, open, high, low, close, volume')
        .eq('trade_date', date)
        .order('symbol');

      if (phErr) throw new Error(phErr.message);

      // Map to DailyStockEod shape for backward compat with MarketDataPage
      const mapped: DailyStockEod[] = (phData ?? []).map(row => ({
        id: String(row.id ?? row.symbol),
        symbol: row.symbol ?? '',
        date: row.trade_date ?? date,
        close: row.close ?? 0,
        volume: row.volume ?? 0,
        total_shares: null,
        category: null,
        sector: null,
        pe: null,
        created_at: '',
      }));

      setPrices(mapped);
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
 * Fetch historical prices for a single symbol from public.price_history.
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
        const { data, error: fetchErr } = await marketPublicDb
          .from('price_history')
          .select('id, symbol, trade_date, open, high, low, close, volume')
          .eq('symbol', symbol)
          .order('trade_date', { ascending: true })
          .limit(days);

        if (fetchErr) throw new Error(fetchErr.message);
        if (cancelled) return;

        // Map trade_date → date for HistoricalPrice compat
        const mapped: HistoricalPrice[] = (data ?? []).map(row => ({
          id: String(row.id),
          symbol: row.symbol,
          date: row.trade_date,
          open: row.open,
          high: row.high,
          low: row.low,
          close: row.close,
          volume: row.volume,
          created_at: null,
          updated_at: null,
        }));

        setHistory(mapped);
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
 * Uses public.price_history (canonical price source).
 */
export async function fetchCurrentPrice(symbol: string): Promise<DailyStockEod | null> {
  const { data, error } = await marketPublicDb
    .from('price_history')
    .select('id, symbol, trade_date, close, volume')
    .eq('symbol', symbol)
    .order('trade_date', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return null;
  return {
    id: String(data.id ?? data.symbol),
    symbol: data.symbol ?? symbol,
    date: data.trade_date ?? '',
    close: data.close ?? 0,
    volume: data.volume ?? 0,
    total_shares: null,
    category: null,
    sector: null,
    pe: null,
    created_at: '',
  };
}

/**
 * One-shot function to fetch prices for multiple symbols.
 * Uses public.price_history (canonical price source).
 */
export async function fetchPricesForSymbols(
  symbols: string[],
): Promise<Record<string, DailyStockEod>> {
  if (symbols.length === 0) return {};

  // Get the latest date first
  const { data: dateRow } = await marketPublicDb
    .from('price_history')
    .select('trade_date')
    .order('trade_date', { ascending: false })
    .limit(1)
    .single();

  if (!dateRow) return {};

  const { data, error } = await marketPublicDb
    .from('price_history')
    .select('id, symbol, trade_date, close, volume')
    .in('symbol', symbols)
    .eq('trade_date', dateRow.trade_date as string);

  if (error || !data) return {};

  const result: Record<string, DailyStockEod> = {};
  for (const row of data) {
    result[row.symbol ?? ''] = {
      id: String(row.id ?? row.symbol ?? ''),
      symbol: row.symbol ?? '',
      date: row.trade_date ?? '',
      close: row.close ?? 0,
      volume: row.volume ?? 0,
      total_shares: null,
      category: null,
      sector: null,
      pe: null,
      created_at: '',
    };
  }
  return result;
}
