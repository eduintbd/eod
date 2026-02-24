import { useState, useEffect, useMemo, useCallback } from 'react';
import { RefreshCw, TrendingUp, Search, Database } from 'lucide-react';
import { useAllLatestPrices, useFundamentals } from '@/hooks/useMarketData';
import { formatNumber, formatBDT } from '@/lib/utils';
import { supabase } from '@/lib/supabase';

interface LocalSecurity {
  security_code: string;
  sector: string | null;
  category: string | null;
  trailing_pe: number | null;
  free_float_market_cap: number | null;
  face_value: number | null;
  last_close_price: number | null;
}

/** Fetch enriched securities data from local DB */
function useLocalSecurities() {
  const [securities, setSecurities] = useState<Record<string, LocalSecurity>>({});
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('securities')
        .select('security_code, sector, category, trailing_pe, free_float_market_cap, face_value, last_close_price');
      const byCode: Record<string, LocalSecurity> = {};
      for (const row of (data ?? []) as LocalSecurity[]) {
        if (row.security_code) byCode[row.security_code] = row;
      }
      setSecurities(byCode);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { securities, loading, refresh };
}

export function MarketDataPage() {
  const { prices, latestDate, loading, error, refresh } = useAllLatestPrices();
  const { fundamentals } = useFundamentals();
  const { securities: localSecurities, refresh: refreshSecurities } = useLocalSecurities();
  const [search, setSearch] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [enriching, setEnriching] = useState(false);
  const [enrichResult, setEnrichResult] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!search) return prices;
    const q = search.toUpperCase();
    return prices.filter(p => {
      const sec = localSecurities[p.symbol];
      const sector = sec?.sector ?? p.sector ?? '';
      return p.symbol.includes(q) || sector.toUpperCase().includes(q);
    });
  }, [prices, search, localSecurities]);

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('sync-market-data');
      if (error) throw error;
      setSyncResult(
        `Synced ${data.prices_synced} prices, updated ${data.securities_updated} securities.` +
        (data.errors?.length > 0 ? ` (${data.errors.length} errors)` : '')
      );
      refreshSecurities();
    } catch (err) {
      setSyncResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSyncing(false);
    }
  }

  async function handleEnrich() {
    setEnriching(true);
    setEnrichResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('enrich-securities');
      if (error) throw error;
      if (data.message) {
        setEnrichResult(data.message);
      } else {
        setEnrichResult(
          `DSE enrichment: ${data.updated} updated, ${data.failed} failed, ${data.skipped} skipped (of ${data.total} total)`
        );
      }
      // Refresh local securities to show updated info
      refreshSecurities();
    } catch (err) {
      setEnrichResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setEnriching(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">DSE Market Data</h1>
          <p className="text-sm text-muted-foreground">
            Live data from ucb csm source
            {latestDate && ` — Latest: ${latestDate}`}
            {prices.length > 0 && ` — ${prices.length} stocks`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleEnrich}
            disabled={enriching}
            className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-md text-sm hover:bg-amber-700 disabled:opacity-50"
          >
            <Database size={14} className={enriching ? 'animate-pulse' : ''} />
            {enriching ? 'Enriching...' : 'Enrich from DSE'}
          </button>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90 disabled:opacity-50"
          >
            <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
            Sync to Local DB
          </button>
          <button
            onClick={refresh}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-card border border-border rounded-md text-sm hover:bg-muted"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {syncResult && (
        <div className={`mb-4 p-3 rounded text-sm ${
          syncResult.startsWith('Error') ? 'bg-destructive/10 text-destructive' : 'bg-success/10 text-success'
        }`}>
          {syncResult}
        </div>
      )}

      {enrichResult && (
        <div className={`mb-4 p-3 rounded text-sm ${
          enrichResult.startsWith('Error') ? 'bg-destructive/10 text-destructive' : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
        }`}>
          {enrichResult}
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 rounded bg-destructive/10 text-destructive text-sm">
          Failed to load market data: {error}
        </div>
      )}

      {/* Search */}
      <div className="mb-4 relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by symbol or sector..."
          className="w-full pl-10 pr-4 py-2 bg-card border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>

      {/* Market data table */}
      {loading ? (
        <div className="text-muted-foreground text-sm p-4">Loading market data...</div>
      ) : (
        <div className="bg-card rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground bg-muted/50">
                <th className="p-3">Symbol</th>
                <th className="p-3">Sector</th>
                <th className="p-3">Category</th>
                <th className="p-3 text-right">Close</th>
                <th className="p-3 text-right">Volume</th>
                <th className="p-3 text-right">P/E</th>
                <th className="p-3 text-right">NAV</th>
                <th className="p-3 text-right">Mkt Cap (Cr)</th>
                <th className="p-3 text-right">52W High</th>
                <th className="p-3 text-right">52W Low</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => {
                const sec = localSecurities[p.symbol];
                const f = fundamentals[p.symbol];
                return (
                  <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                    <td className="p-3 font-medium">
                      <div className="flex items-center gap-1">
                        <TrendingUp size={12} className="text-primary" />
                        {p.symbol}
                      </div>
                    </td>
                    <td className="p-3 text-xs">{sec?.sector ?? p.sector ?? f?.sector ?? '—'}</td>
                    <td className="p-3">
                      {(sec?.category ?? p.category ?? f?.category) && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted">
                          {sec?.category ?? p.category ?? f?.category}
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-right font-medium">{formatNumber(p.close)}</td>
                    <td className="p-3 text-right text-muted-foreground">{formatNumber(p.volume, 0)}</td>
                    <td className="p-3 text-right">{sec?.trailing_pe ?? p.pe ?? f?.pe ?? '—'}</td>
                    <td className="p-3 text-right">{f?.nav != null ? formatNumber(f.nav) : '—'}</td>
                    <td className="p-3 text-right">
                      {sec?.free_float_market_cap != null
                        ? formatBDT(sec.free_float_market_cap)
                        : f?.market_cap != null
                          ? formatBDT(f.market_cap)
                          : '—'}
                    </td>
                    <td className="p-3 text-right">{f?.year_high != null ? formatNumber(f.year_high) : '—'}</td>
                    <td className="p-3 text-right">{f?.year_low != null ? formatNumber(f.year_low) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground text-center">No matching stocks found.</p>
          )}
        </div>
      )}
    </div>
  );
}
