import { useState, useEffect, useMemo, useCallback } from 'react';
import { RefreshCw, TrendingUp, Search, Database, ShieldCheck } from 'lucide-react';
import { useAllLatestPrices, useFundamentals } from '@/hooks/useMarketData';
import { marketDb, marketPublicDb } from '@/lib/supabase-market';
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
  is_marginable: boolean | null;
  marginability_reason: string | null;
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
        .select('security_code, sector, category, trailing_pe, free_float_market_cap, face_value, last_close_price, is_marginable, marginability_reason');
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
  const [syncDate, setSyncDate] = useState('');
  const { prices, latestDate, loading, error, refresh } = useAllLatestPrices(syncDate || undefined);
  const { fundamentals } = useFundamentals();
  const { securities: localSecurities, refresh: refreshSecurities } = useLocalSecurities();
  const [search, setSearch] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [enriching, setEnriching] = useState(false);
  const [enrichResult, setEnrichResult] = useState<string | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [classifyResult, setClassifyResult] = useState<string | null>(null);

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
      // Use selected date or fetch latest from public.price_history
      let targetDate = syncDate;
      if (!targetDate) {
        const { data: dateRow, error: dateErr } = await marketPublicDb
          .from('price_history')
          .select('trade_date')
          .order('trade_date', { ascending: false })
          .limit(1)
          .single();
        if (dateErr) throw new Error(`Source date: ${dateErr.message}`);
        targetDate = dateRow.trade_date;
      }

      // Fetch OHLCV from public.price_history for that date
      const { data: hpData, error: hpErr } = await marketPublicDb
        .from('price_history')
        .select('symbol, trade_date, open, high, low, close, volume')
        .eq('trade_date', targetDate);
      if (hpErr) throw new Error(`Price fetch: ${hpErr.message}`);
      if (!hpData?.length) throw new Error(`No prices found for ${targetDate}`);

      // Map symbol → isin from local securities
      const { data: secs } = await supabase.from('securities').select('isin, security_code');
      const codeToIsin: Record<string, string> = {};
      for (const s of secs ?? []) {
        if (s.security_code) codeToIsin[s.security_code.toUpperCase()] = s.isin;
      }

      // Upsert into daily_prices with full OHLCV
      const priceRows = hpData
        .filter(p => codeToIsin[p.symbol?.toUpperCase()])
        .map(p => ({
          isin: codeToIsin[p.symbol.toUpperCase()],
          date: p.trade_date,
          open_price: p.open,
          high_price: p.high,
          low_price: p.low,
          close_price: p.close,
          volume: p.volume,
          source: 'DSE',
        }));

      let synced = 0;
      for (let i = 0; i < priceRows.length; i += 500) {
        const batch = priceRows.slice(i, i + 500);
        const { error: upErr } = await supabase.from('daily_prices').upsert(batch, { onConflict: 'isin,date' });
        if (upErr) throw new Error(`Price upsert: ${upErr.message}`);
        synced += batch.length;
      }

      // Update last_close_price on securities
      let priceUpdated = 0;
      const BATCH = 50;
      const matched = hpData.filter(p => codeToIsin[p.symbol?.toUpperCase()]);
      for (let i = 0; i < matched.length; i += BATCH) {
        const batch = matched.slice(i, i + BATCH);
        await Promise.all(batch.map(p =>
          supabase.from('securities').update({ last_close_price: p.close }).eq('isin', codeToIsin[p.symbol.toUpperCase()])
        ));
        priceUpdated += batch.length;
      }

      setSyncResult(`Synced ${synced} prices (OHLCV) for ${targetDate}, updated ${priceUpdated} securities.`);
      refresh();
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
      // Load fundamentals from dse_market_data schema
      const { data: fundRows } = await marketDb.from('stock_fundamentals')
        .select('symbol, market_cap, face_value, pe, sector, category');
      // Load stocks from public schema (has category for ALL 417 stocks)
      const { data: stockRows } = await marketPublicDb.from('stocks')
        .select('symbol, category, sector');

      const fundMap: Record<string, typeof fundRows extends (infer T)[] | null ? T : never> = {};
      for (const f of fundRows ?? []) { if (f.symbol) fundMap[f.symbol.toUpperCase()] = f; }
      const stockMap: Record<string, typeof stockRows extends (infer T)[] | null ? T : never> = {};
      for (const s of stockRows ?? []) { if (s.symbol) stockMap[s.symbol.toUpperCase()] = s; }

      // Load local securities
      const { data: localSecs } = await supabase.from('securities')
        .select('isin, security_code, category, board, sector, trailing_pe, free_float_market_cap, face_value');

      let updated = 0, skipped = 0, noMatch = 0;
      const BATCH = 50;
      const pending: Array<{ isin: string; updates: Record<string, unknown> }> = [];

      for (const sec of localSecs ?? []) {
        const code = (sec.security_code || '').toUpperCase();
        const fund = fundMap[code];
        const stock = stockMap[code];
        if (!fund && !stock) { noMatch++; continue; }

        const updates: Record<string, unknown> = {};
        // Category: prefer stocks table (100% coverage), then fundamentals
        const newCat = stock?.category || fund?.category || null;
        if (newCat && newCat !== '-' && !sec.category) updates.category = newCat;
        const newSector = stock?.sector || fund?.sector || null;
        if (newSector && !sec.sector) updates.sector = newSector;
        const newPE = fund?.pe || null;
        if (newPE && newPE > 0 && sec.trailing_pe == null) updates.trailing_pe = newPE;
        if (fund?.face_value != null && sec.face_value == null) updates.face_value = fund.face_value;
        if (fund?.market_cap != null && sec.free_float_market_cap == null) updates.free_float_market_cap = fund.market_cap;
        const effectiveCat = (updates.category || sec.category) as string | null;
        if (!sec.board && effectiveCat && ['A', 'B', 'Z', 'N'].includes(effectiveCat)) updates.board = 'PUBLIC';

        if (Object.keys(updates).length === 0) { skipped++; continue; }
        pending.push({ isin: sec.isin, updates });
      }

      for (let i = 0; i < pending.length; i += BATCH) {
        const batch = pending.slice(i, i + BATCH);
        await Promise.all(batch.map(p => supabase.from('securities').update(p.updates).eq('isin', p.isin)));
        updated += batch.length;
      }

      setEnrichResult(`Enriched ${updated} securities from source DB. Skipped: ${skipped}, No match: ${noMatch}.`);
      refreshSecurities();
    } catch (err) {
      setEnrichResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setEnriching(false);
    }
  }

  async function handleClassify() {
    setClassifying(true);
    setClassifyResult(null);
    try {
      // Load margin config
      const { data: configRows } = await supabase.from('margin_config').select('key, value');
      const cfg: Record<string, number> = {};
      for (const r of configRows ?? []) cfg[r.key] = r.value;
      const minFFMC = cfg.min_ffmc_mn ?? 500;
      const maxPE = cfg.max_trailing_pe ?? 30;
      const peMult = cfg.sectoral_pe_multiplier ?? 2;

      // Load securities
      const { data: secs } = await supabase.from('securities')
        .select('isin, security_code, category, board, sector, trailing_pe, free_float_market_cap, annual_dividend_pct, status, asset_class');
      if (!secs) throw new Error('Failed to load securities');

      // Sectoral median P/E
      const sectorPEs: Record<string, number[]> = {};
      for (const s of secs) {
        if (s.sector && s.trailing_pe > 0) {
          if (!sectorPEs[s.sector]) sectorPEs[s.sector] = [];
          sectorPEs[s.sector].push(s.trailing_pe);
        }
      }
      const medians: Record<string, number> = {};
      for (const [sector, vals] of Object.entries(sectorPEs)) {
        const sorted = [...vals].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        medians[sector] = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
      }

      type SecRow = NonNullable<typeof secs>[0];
      function classify(s: SecRow): { is_marginable: boolean; reason: string } {
        if (!s.category || ['N', 'Z', 'G', 'S'].includes(s.category))
          return { is_marginable: false, reason: `Category '${s.category ?? 'NULL'}' is not marginable` };
        if (s.status === 'suspended')
          return { is_marginable: false, reason: 'Security is suspended' };
        if (!s.board || s.board !== 'PUBLIC')
          return { is_marginable: false, reason: `Board '${s.board ?? 'NULL'}' — only Main Board (PUBLIC) is marginable` };
        if (s.asset_class === 'MF')
          return { is_marginable: false, reason: 'Mutual fund securities are not marginable' };
        if (!['A', 'B'].includes(s.category))
          return { is_marginable: false, reason: `Category '${s.category}' — only A and B are marginable` };
        if (s.category === 'B' && (s.annual_dividend_pct == null || s.annual_dividend_pct < 5))
          return { is_marginable: false, reason: `B-category requires >= 5% annual dividend (current: ${s.annual_dividend_pct ?? 'not set'})` };
        if (s.trailing_pe == null || s.trailing_pe <= 0)
          return { is_marginable: false, reason: `Negative or missing EPS (P/E: ${s.trailing_pe ?? 'NULL'})` };
        if (s.trailing_pe > maxPE)
          return { is_marginable: false, reason: `Trailing P/E (${s.trailing_pe}) exceeds max (${maxPE})` };
        if (s.sector && medians[s.sector]) {
          const limit = peMult * medians[s.sector];
          if (s.trailing_pe > limit)
            return { is_marginable: false, reason: `P/E (${s.trailing_pe}) exceeds ${peMult}x sectoral median (${medians[s.sector].toFixed(1)})` };
        }
        if (s.free_float_market_cap == null || s.free_float_market_cap < minFFMC)
          return { is_marginable: false, reason: `Free float market cap (${s.free_float_market_cap ?? 'NULL'} mn) below ${minFFMC} mn` };
        return { is_marginable: true, reason: 'Meets all BSEC marginability criteria' };
      }

      const now = new Date().toISOString();
      let marginable = 0;
      const updates = secs.map(s => {
        const r = classify(s);
        if (r.is_marginable) marginable++;
        return { isin: s.isin, ...r };
      });

      const BATCH = 50;
      for (let i = 0; i < updates.length; i += BATCH) {
        const batch = updates.slice(i, i + BATCH);
        await Promise.all(batch.map(u =>
          supabase.from('securities').update({
            is_marginable: u.is_marginable,
            marginability_reason: u.reason,
            marginability_updated_at: now,
          }).eq('isin', u.isin)
        ));
      }

      setClassifyResult(`Classification complete: ${marginable} marginable, ${secs.length - marginable} non-marginable (of ${secs.length} total)`);
      refreshSecurities();
    } catch (err) {
      setClassifyResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setClassifying(false);
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
            onClick={handleClassify}
            disabled={classifying}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-md text-sm hover:bg-emerald-700 disabled:opacity-50"
          >
            <ShieldCheck size={14} className={classifying ? 'animate-pulse' : ''} />
            {classifying ? 'Classifying...' : 'Classify Margin'}
          </button>
          <button
            onClick={handleEnrich}
            disabled={enriching}
            className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-md text-sm hover:bg-amber-700 disabled:opacity-50"
          >
            <Database size={14} className={enriching ? 'animate-pulse' : ''} />
            {enriching ? 'Enriching...' : 'Enrich from DSE'}
          </button>
          <input
            type="date"
            value={syncDate}
            onChange={e => setSyncDate(e.target.value)}
            placeholder="Latest"
            className="px-2 py-2 bg-card border border-border rounded-md text-sm w-36"
          />
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm hover:bg-primary/90 disabled:opacity-50"
          >
            <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
            Sync Prices
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

      {classifyResult && (
        <div className={`mb-4 p-3 rounded text-sm ${
          classifyResult.startsWith('Error') ? 'bg-destructive/10 text-destructive' : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
        }`}>
          {classifyResult}
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
                <th className="p-3">Margin</th>
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
                    <td className="p-3">
                      {sec?.is_marginable != null && (
                        <span
                          className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium cursor-help ${
                            sec.is_marginable
                              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                              : 'bg-muted text-muted-foreground'
                          }`}
                          title={sec.marginability_reason ?? ''}
                        >
                          {sec.is_marginable ? 'Eligible' : 'Ineligible'}
                        </span>
                      )}
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
