import { corsHeaders } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/supabase-client.ts';
import { loadMarginConfig } from '../_shared/margin-config.ts';

interface SecurityRow {
  isin: string;
  security_code: string | null;
  category: string | null;
  board: string | null;
  sector: string | null;
  trailing_pe: number | null;
  free_float_market_cap: number | null;
  annual_dividend_pct: number | null;
  status: string | null;
  asset_class: string | null;
}

/**
 * Compute the median of a sorted array of numbers.
 */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = getServiceClient();
    const body = await req.json().catch(() => ({}));
    const targetIsins: string[] | undefined = body.isins;
    const dryRun: boolean = body.dry_run ?? false;

    // Step 1: Load margin config
    const config = await loadMarginConfig(supabase);

    // Step 2: Fetch securities
    let query = supabase
      .from('securities')
      .select('isin, security_code, category, board, sector, trailing_pe, free_float_market_cap, annual_dividend_pct, status, asset_class');

    if (targetIsins && targetIsins.length > 0) {
      query = query.in('isin', targetIsins);
    }

    const { data: securities, error: secErr } = await query;
    if (secErr) throw new Error(`Fetch securities: ${secErr.message}`);
    if (!securities || securities.length === 0) {
      return new Response(
        JSON.stringify({ total_securities: 0, marginable_count: 0, non_marginable_count: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 3: Compute sectoral median P/E (exclude negative/null P/E)
    const sectorPEs: Record<string, number[]> = {};
    for (const sec of securities as SecurityRow[]) {
      if (sec.sector && sec.trailing_pe != null && sec.trailing_pe > 0) {
        if (!sectorPEs[sec.sector]) sectorPEs[sec.sector] = [];
        sectorPEs[sec.sector].push(sec.trailing_pe);
      }
    }

    const sectoralMedians: Record<string, number> = {};
    for (const [sector, peValues] of Object.entries(sectorPEs)) {
      sectoralMedians[sector] = median(peValues);
    }

    // Step 4: Classify each security
    const results: Array<{ isin: string; is_marginable: boolean; reason: string | null }> = [];
    const reasonCounts: Record<string, number> = {};

    for (const sec of securities as SecurityRow[]) {
      const result = classifySecurity(sec, config, sectoralMedians);
      results.push({ isin: sec.isin, ...result });

      if (!result.is_marginable && result.reason) {
        reasonCounts[result.reason] = (reasonCounts[result.reason] || 0) + 1;
      }
    }

    const marginableCount = results.filter(r => r.is_marginable).length;
    const nonMarginableCount = results.filter(r => !r.is_marginable).length;

    // Step 5: Update database (unless dry run)
    if (!dryRun) {
      const now = new Date().toISOString();
      const BATCH = 50;
      for (let i = 0; i < results.length; i += BATCH) {
        const batch = results.slice(i, i + BATCH);
        for (const r of batch) {
          await supabase
            .from('securities')
            .update({
              is_marginable: r.is_marginable,
              marginability_reason: r.reason,
              marginability_updated_at: now,
            })
            .eq('isin', r.isin);
        }
      }
    }

    return new Response(
      JSON.stringify({
        total_securities: securities.length,
        marginable_count: marginableCount,
        non_marginable_count: nonMarginableCount,
        reasons_breakdown: reasonCounts,
        sectoral_medians: sectoralMedians,
        dry_run: dryRun,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

/**
 * Apply BSEC Margin Rules 2025 Sections 10 & 11 to determine if a security is marginable.
 * Checks are applied in order — first failing check sets the reason.
 */
function classifySecurity(
  sec: SecurityRow,
  config: { min_ffmc_mn: number; max_trailing_pe: number; sectoral_pe_multiplier: number },
  sectoralMedians: Record<string, number>,
): { is_marginable: boolean; reason: string | null } {
  // Section 11(8): N, Z, G categories are never marginable
  // Also exclude S (SME category)
  if (!sec.category || ['N', 'Z', 'G', 'S'].includes(sec.category)) {
    return { is_marginable: false, reason: `Category '${sec.category ?? 'NULL'}' is not marginable` };
  }

  // Section 11(12): Suspended securities
  if (sec.status === 'suspended') {
    return { is_marginable: false, reason: 'Security is suspended' };
  }

  // Section 10(2): Only Main Board (PUBLIC). SME, ATB, OTC, SPUBLIC excluded.
  if (!sec.board || sec.board !== 'PUBLIC') {
    return { is_marginable: false, reason: `Board '${sec.board ?? 'NULL'}' — only Main Board (PUBLIC) is marginable` };
  }

  // Section 11(9): Mutual funds / closed-end funds not marginable
  if (sec.asset_class === 'MF') {
    return { is_marginable: false, reason: 'Mutual fund securities are not marginable' };
  }

  // Section 10(1): Only A and B category
  if (!['A', 'B'].includes(sec.category)) {
    return { is_marginable: false, reason: `Category '${sec.category}' — only A and B are marginable` };
  }

  // Section 10(1) proviso: B-category requires >= 5% annual dividend
  if (sec.category === 'B') {
    if (sec.annual_dividend_pct == null || sec.annual_dividend_pct < 5) {
      return { is_marginable: false, reason: `B-category requires >= 5% annual dividend (current: ${sec.annual_dividend_pct ?? 'not set'})` };
    }
  }

  // Section 11(5): Negative or missing EPS (indicated by negative or null P/E)
  if (sec.trailing_pe == null || sec.trailing_pe <= 0) {
    return { is_marginable: false, reason: `Negative or missing EPS (P/E: ${sec.trailing_pe ?? 'NULL'})` };
  }

  // Section 11(4): Trailing P/E > max (30)
  if (sec.trailing_pe > config.max_trailing_pe) {
    return { is_marginable: false, reason: `Trailing P/E (${sec.trailing_pe}) exceeds max (${config.max_trailing_pe})` };
  }

  // Section 11(4) proviso: P/E > 2x sectoral median
  if (sec.sector && sectoralMedians[sec.sector]) {
    const sectorMedian = sectoralMedians[sec.sector];
    const peLimit = config.sectoral_pe_multiplier * sectorMedian;
    if (sec.trailing_pe > peLimit) {
      return {
        is_marginable: false,
        reason: `P/E (${sec.trailing_pe}) exceeds ${config.sectoral_pe_multiplier}x sectoral median (${sectorMedian.toFixed(2)}, limit: ${peLimit.toFixed(2)})`,
      };
    }
  }

  // Section 11(3): Free float market cap < 50 Crore (500mn)
  if (sec.free_float_market_cap == null || sec.free_float_market_cap < config.min_ffmc_mn) {
    return {
      is_marginable: false,
      reason: `Free float market cap (${sec.free_float_market_cap ?? 'NULL'} mn) below ${config.min_ffmc_mn} mn (${config.min_ffmc_mn / 10} Crore)`,
    };
  }

  // All checks passed — security is marginable
  return { is_marginable: true, reason: 'Meets all BSEC marginability criteria' };
}
