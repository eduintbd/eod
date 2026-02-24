import { corsHeaders } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/supabase-client.ts';

const DAY_END_URL = 'https://www.dsebd.org/day_end_archive.php';

/**
 * Backfill historical daily prices by scraping DSE day-end archive.
 *
 * POST body (optional):
 *   { days?: number }   – how many calendar days to backfill (default 30, max 60)
 *
 * Fetches one date at a time (all instruments) from DSE, parses the HTML table,
 * and upserts into local daily_prices. Skips weekends (Fri-Sat in Bangladesh)
 * and dates that already have data.
 */

interface PriceRow {
  symbol: string;
  date: string;
  open_price: number | null;
  high_price: number | null;
  low_price: number | null;
  close_price: number | null;
  volume: number | null;
  value: number | null;
  num_trades: number | null;
}

function parseNum(s: string): number | null {
  const cleaned = s.replace(/,/g, '').trim();
  if (cleaned === '' || cleaned === '--') return null;
  const n = Number(cleaned);
  return isNaN(n) ? null : n;
}

/** Parse the day-end archive HTML table into price rows */
function parseDayEndArchive(html: string): PriceRow[] {
  const rows: PriceRow[] = [];

  // Match each table row: date, symbol, LTP, HIGH, LOW, OPENP, CLOSEP, YCP, TRADE, VALUE, VOLUME
  // Pattern: <td ...>DATE</td> ... <a ...>SYMBOL</a> ... then 9 <td> cells
  const rowRegex = /<td[^>]*>(\d{4}-\d{2}-\d{2})<\/td>\s*<td[^>]*>\s*<a[^>]*>\s*(\S+)\s*<\/a>\s*<\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*>([^<]*)<\/td>/g;

  let match;
  while ((match = rowRegex.exec(html)) !== null) {
    const [, date, symbol, ltp, high, low, openp, closep, _ycp, trades, valueMn, volume] = match;
    rows.push({
      symbol: symbol.trim(),
      date,
      open_price: parseNum(openp),
      high_price: parseNum(high),
      low_price: parseNum(low),
      close_price: parseNum(closep) ?? parseNum(ltp),
      volume: parseNum(volume),
      value: parseNum(valueMn),
      num_trades: parseNum(trades),
    });
  }

  return rows;
}

/** Format date as YYYY-MM-DD */
function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Get trading dates (skip Fri/Sat — Bangladesh weekend) going back N calendar days */
function getTradingDates(days: number): string[] {
  const dates: string[] = [];
  const now = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dow = d.getDay(); // 0=Sun, 5=Fri, 6=Sat
    if (dow !== 5 && dow !== 6) {
      dates.push(formatDate(d));
    }
  }
  return dates;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const localDb = getServiceClient();

    let days = 30;
    try {
      const body = await req.json();
      if (typeof body.days === 'number' && body.days > 0) {
        days = Math.min(body.days, 60);
      }
    } catch {
      // default 30 days
    }

    // Get all securities to map symbol → isin
    const { data: securities } = await localDb
      .from('securities')
      .select('isin, security_code');

    const codeToIsin: Record<string, string> = {};
    for (const s of securities ?? []) {
      if (s.security_code) {
        codeToIsin[s.security_code.toUpperCase()] = s.isin;
      }
    }

    // Check which dates already have data
    const tradingDates = getTradingDates(days);
    const { data: existingDates } = await localDb
      .from('daily_prices')
      .select('date')
      .in('date', tradingDates)
      .limit(1000);

    // Count rows per date to determine if a date is "complete"
    const dateRowCounts: Record<string, number> = {};
    for (const row of existingDates ?? []) {
      dateRowCounts[row.date] = (dateRowCounts[row.date] || 0) + 1;
    }

    // Skip dates that already have a reasonable number of rows (>100 means likely complete)
    const datesToFetch = tradingDates.filter(d => (dateRowCounts[d] || 0) < 100);

    const results = {
      dates_checked: tradingDates.length,
      dates_fetched: 0,
      dates_skipped: tradingDates.length - datesToFetch.length,
      prices_stored: 0,
      errors: [] as string[],
    };

    // Fetch each date from DSE (one request per date, all instruments)
    for (let i = 0; i < datesToFetch.length; i++) {
      const date = datesToFetch[i];

      try {
        const url = `${DAY_END_URL}?startDate=${date}&endDate=${date}&inst=All%20Instrument&archive=data`;
        const response = await fetch(url);

        if (!response.ok) {
          results.errors.push(`${date}: HTTP ${response.status}`);
          continue;
        }

        const html = await response.text();
        const priceRows = parseDayEndArchive(html);

        if (priceRows.length === 0) {
          // Probably a holiday or no data — not an error
          continue;
        }

        results.dates_fetched++;

        // Map to local daily_prices format
        const dbRows = [];
        for (const p of priceRows) {
          const isin = codeToIsin[p.symbol.toUpperCase()];
          if (!isin) continue;

          dbRows.push({
            isin,
            date: p.date,
            open_price: p.open_price,
            high_price: p.high_price,
            low_price: p.low_price,
            close_price: p.close_price,
            volume: p.volume,
            value: p.value,
            num_trades: p.num_trades,
            source: 'DSE',
          });
        }

        if (dbRows.length > 0) {
          // Batch upsert
          const BATCH = 500;
          for (let b = 0; b < dbRows.length; b += BATCH) {
            const batch = dbRows.slice(b, b + BATCH);
            const { error: upsertErr } = await localDb
              .from('daily_prices')
              .upsert(batch, { onConflict: 'isin,date' });

            if (upsertErr) {
              results.errors.push(`${date} batch ${b}: ${upsertErr.message}`);
            } else {
              results.prices_stored += batch.length;
            }
          }
        }
      } catch (err) {
        results.errors.push(`${date}: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Rate limit between date fetches
      if (i < datesToFetch.length - 1) {
        await delay(500);
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
