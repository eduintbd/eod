import { corsHeaders } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/supabase-client.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const DSE_BASE_URL = 'https://www.dsebd.org/displayCompany.php?name=';

/**
 * Enrich local securities table by scraping DSE website.
 *
 * POST body (optional):
 *   { symbols?: string[] }   – enrich specific symbols
 *   { seed: true }           – seed securities from ucb csm daily_stock_eod, then enrich all
 *   {}                       – find all securities with missing data and enrich
 *
 * For each symbol, fetches the DSE company page and extracts:
 *   sector, category, market_cap, free_float_market_cap, face_value,
 *   trailing_pe, total_shares, listing_year, 52-week range, authorized/paid-up capital
 *
 * Updates the local `securities` table with extracted data.
 */

function getMarketDataClient() {
  const url = Deno.env.get('MARKET_DATA_URL') || Deno.env.get('VITE_MARKET_DATA_URL')!;
  const key = Deno.env.get('MARKET_DATA_SERVICE_ROLE_KEY')!;
  return createClient(url, key, {
    db: { schema: 'dse_market_data' },
    auth: { persistSession: false },
  });
}

interface ParsedData {
  sector?: string;
  category?: string;
  face_value?: number;
  free_float_market_cap?: number;
  market_cap?: number;
  trailing_pe?: number;
  total_shares?: number;
  listing_year?: number;
  week52_high?: number;
  week52_low?: number;
  authorized_capital?: number;
  paid_up_capital?: number;
}

/** Extract a table cell value by its label from DSE HTML.
 *  DSE uses both <th>label</th><td>value</td> and <td>label</td><td>value</td> patterns. */
function extractField(html: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Try <th>label</th> ... <td>value</td>
  const thRegex = new RegExp(
    `>${escaped}\\s*</th>\\s*<td[^>]*>\\s*([^<]+?)\\s*</td>`,
    'i',
  );
  const thMatch = html.match(thRegex);
  if (thMatch) {
    const val = thMatch[1].trim();
    if (val !== '' && val !== '--' && val !== 'N/A') return val;
  }
  // Try <td ...>label</td> ... <td>value</td>
  const tdRegex = new RegExp(
    `>${escaped}\\s*</td>\\s*<td[^>]*>\\s*([^<]+?)\\s*</td>`,
    'i',
  );
  const tdMatch = html.match(tdRegex);
  if (tdMatch) {
    const val = tdMatch[1].trim();
    if (val !== '' && val !== '--' && val !== 'N/A') return val;
  }
  return null;
}

/** Parse a numeric string that may contain commas */
function parseNum(s: string | null): number | null {
  if (!s) return null;
  const cleaned = s.replace(/,/g, '').trim();
  const n = Number(cleaned);
  return isNaN(n) ? null : n;
}

/** Parse DSE company page HTML into structured data */
function parseDsePage(html: string): ParsedData {
  const data: ParsedData = {};

  const sector = extractField(html, 'Sector');
  if (sector) data.sector = sector;

  const category = extractField(html, 'Market Category');
  if (category) data.category = category;

  const marketCap = parseNum(extractField(html, 'Market Capitalization (mn)'));
  if (marketCap != null) data.market_cap = marketCap;

  const freeFloatCap = parseNum(extractField(html, 'Free Float Market Cap. (mn)'));
  if (freeFloatCap != null) data.free_float_market_cap = freeFloatCap;

  const faceValue = parseNum(extractField(html, 'Face/par Value'));
  if (faceValue != null) data.face_value = faceValue;

  const pe = parseNum(extractField(html, 'Trailing P/E Ratio'));
  if (pe != null) data.trailing_pe = pe;

  const totalShares = parseNum(extractField(html, 'Total No. of Outstanding Securities'));
  if (totalShares != null) data.total_shares = totalShares;

  const listingYear = parseNum(extractField(html, 'Listing Year'));
  if (listingYear != null) data.listing_year = listingYear;

  // 52 Weeks' Moving Range: "LOW - HIGH"
  const weekRange = extractField(html, "52 Weeks' Moving Range");
  if (weekRange) {
    const parts = weekRange.split('-').map(s => s.trim());
    if (parts.length === 2) {
      const low = parseNum(parts[0]);
      const high = parseNum(parts[1]);
      if (low != null) data.week52_low = low;
      if (high != null) data.week52_high = high;
    }
  }

  const authCap = parseNum(extractField(html, 'Authorized Capital (mn)'));
  if (authCap != null) data.authorized_capital = authCap;

  const paidCap = parseNum(extractField(html, 'Paid-up Capital (mn)'));
  if (paidCap != null) data.paid_up_capital = paidCap;

  return data;
}

/** Map parsed DSE data to securities table columns */
function toSecuritiesUpdate(parsed: ParsedData): Record<string, unknown> {
  const updates: Record<string, unknown> = {};

  if (parsed.sector) updates.sector = parsed.sector;
  if (parsed.category) updates.category = parsed.category;
  if (parsed.face_value != null) updates.face_value = parsed.face_value;
  if (parsed.trailing_pe != null) updates.trailing_pe = parsed.trailing_pe;

  // Use free_float_market_cap if available, otherwise fall back to market_cap
  if (parsed.free_float_market_cap != null) {
    updates.free_float_market_cap = parsed.free_float_market_cap;
  } else if (parsed.market_cap != null) {
    updates.free_float_market_cap = parsed.market_cap;
  }

  return updates;
}

/** Delay helper */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const localDb = getServiceClient();

    // Parse optional body
    let requestedSymbols: string[] | null = null;
    let seedMode = false;
    let batchLimit = 0; // 0 = no limit
    try {
      const body = await req.json();
      if (body.seed === true) {
        seedMode = true;
      } else if (body.symbols && Array.isArray(body.symbols) && body.symbols.length > 0) {
        requestedSymbols = body.symbols;
      }
      if (typeof body.limit === 'number' && body.limit > 0) {
        batchLimit = body.limit;
      }
    } catch {
      // No body or invalid JSON — enrich all missing
    }

    let seeded = 0;

    // --- Seed mode: bulk-create securities from ucb csm daily_stock_eod ---
    if (seedMode) {
      const marketDb = getMarketDataClient();

      // Get the latest date
      const { data: dateRow, error: dateErr } = await marketDb
        .from('daily_stock_eod')
        .select('date')
        .order('date', { ascending: false })
        .limit(1)
        .single();

      if (dateErr) {
        return new Response(
          JSON.stringify({ error: `Failed to get latest date from source: ${dateErr.message}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      // Fetch all symbols for that date
      const { data: eodRows, error: eodErr } = await marketDb
        .from('daily_stock_eod')
        .select('symbol, close, volume, category, sector, pe')
        .eq('date', dateRow.date);

      if (eodErr) {
        return new Response(
          JSON.stringify({ error: `Failed to fetch EOD data: ${eodErr.message}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      // Deduplicate symbols
      const uniqueSymbols = new Map<string, typeof eodRows[0]>();
      for (const row of eodRows ?? []) {
        if (row.symbol && !uniqueSymbols.has(row.symbol)) {
          uniqueSymbols.set(row.symbol, row);
        }
      }

      // Get existing security_codes to avoid duplicates
      const { data: existing } = await localDb
        .from('securities')
        .select('security_code');
      const existingCodes = new Set(
        (existing ?? []).map((s: { security_code: string }) => s.security_code?.toUpperCase()),
      );

      // Insert new securities with DSE-{symbol} as placeholder ISIN
      const newRows = [];
      for (const [symbol, row] of uniqueSymbols) {
        if (existingCodes.has(symbol.toUpperCase())) continue;
        newRows.push({
          isin: `DSE-${symbol}`,
          security_code: symbol,
          company_name: symbol,
          asset_class: 'EQ',
          category: row.category || null,
          sector: row.sector || null,
          last_close_price: row.close || null,
          trailing_pe: row.pe || null,
          status: 'active',
        });
      }

      if (newRows.length > 0) {
        const BATCH = 200;
        for (let i = 0; i < newRows.length; i += BATCH) {
          const batch = newRows.slice(i, i + BATCH);
          const { error: insertErr } = await localDb
            .from('securities')
            .upsert(batch, { onConflict: 'isin', ignoreDuplicates: true });
          if (insertErr) {
            return new Response(
              JSON.stringify({ error: `Failed to seed securities: ${insertErr.message}` }),
              { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            );
          }
          seeded += batch.length;
        }
      }
    }

    // Determine which symbols to enrich
    let symbols: string[];

    if (requestedSymbols) {
      symbols = requestedSymbols;
    } else {
      // Find all securities with missing sector or category
      const { data: missing, error: missErr } = await localDb
        .from('securities')
        .select('security_code')
        .or('sector.is.null,category.is.null,trailing_pe.is.null,free_float_market_cap.is.null')
        .not('security_code', 'is', null);

      if (missErr) {
        return new Response(
          JSON.stringify({ error: `Failed to query securities: ${missErr.message}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      symbols = (missing ?? []).map((r: { security_code: string }) => r.security_code);
    }

    // Apply batch limit
    const remaining = symbols.length;
    if (batchLimit > 0 && symbols.length > batchLimit) {
      symbols = symbols.slice(0, batchLimit);
    }

    if (symbols.length === 0) {
      return new Response(
        JSON.stringify({ message: seeded > 0 ? `Seeded ${seeded} securities, all already enriched` : 'No securities need enrichment', seeded, updated: 0, failed: 0, details: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const results = {
      seeded,
      total: symbols.length,
      remaining: remaining - symbols.length,
      updated: 0,
      failed: 0,
      skipped: 0,
      details: [] as { symbol: string; status: string; fields?: string[] }[],
    };

    for (let i = 0; i < symbols.length; i++) {
      const symbol = symbols[i];

      try {
        // Fetch DSE page
        const url = `${DSE_BASE_URL}${encodeURIComponent(symbol)}`;
        const response = await fetch(url);

        if (!response.ok) {
          results.failed++;
          results.details.push({ symbol, status: `HTTP ${response.status}` });
          continue;
        }

        const html = await response.text();

        // Check if the page actually has data (DSE returns a page even for invalid symbols)
        if (!html.includes('Sector') || html.includes('No Company Found')) {
          results.skipped++;
          results.details.push({ symbol, status: 'not_found_on_dse' });
          continue;
        }

        // Parse data from HTML
        const parsed = parseDsePage(html);
        const updates = toSecuritiesUpdate(parsed);

        if (Object.keys(updates).length === 0) {
          results.skipped++;
          results.details.push({ symbol, status: 'no_extractable_data' });
          continue;
        }

        // Update securities table
        const { error: updateErr } = await localDb
          .from('securities')
          .update(updates)
          .eq('security_code', symbol);

        if (updateErr) {
          results.failed++;
          results.details.push({ symbol, status: `db_error: ${updateErr.message}` });
        } else {
          results.updated++;
          results.details.push({
            symbol,
            status: 'updated',
            fields: Object.keys(updates),
          });
        }
      } catch (err) {
        results.failed++;
        results.details.push({
          symbol,
          status: `error: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      // Rate limit: 300ms between requests to be polite to DSE
      if (i < symbols.length - 1) {
        await delay(300);
      }
    }

    return new Response(
      JSON.stringify(results),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
