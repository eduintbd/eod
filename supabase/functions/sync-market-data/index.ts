import { corsHeaders } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/supabase-client.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

/**
 * Sync market data from the source project (ucb csm) into the local
 * daily_prices and securities tables.
 *
 * This function:
 * 1. Reads latest daily_stock_eod from the source project
 * 2. Upserts into local daily_prices table
 * 3. Updates last_close_price on securities
 *
 * Fundamentals enrichment (sector, category, PE, etc.) is handled
 * separately by the `enrich-securities` Edge Function which scrapes DSE.
 */

function getMarketDataClient() {
  const url = Deno.env.get('MARKET_DATA_URL') || Deno.env.get('VITE_MARKET_DATA_URL')!;
  const key = Deno.env.get('MARKET_DATA_SERVICE_ROLE_KEY')!;
  return createClient(url, key, {
    db: { schema: 'dse_market_data' },
    auth: { persistSession: false },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const localDb = getServiceClient();
    const marketDb = getMarketDataClient();

    const results = {
      prices_synced: 0,
      securities_updated: 0,
      errors: [] as string[],
    };

    // --- Step 1: Sync daily_stock_eod → local daily_prices ---

    // Find the latest date in the source
    const { data: dateRow, error: dateErr } = await marketDb
      .from('daily_stock_eod')
      .select('date')
      .order('date', { ascending: false })
      .limit(1)
      .single();

    if (dateErr) {
      results.errors.push(`Failed to get latest date: ${dateErr.message}`);
    }

    if (dateRow) {
      const latestDate = dateRow.date;

      // Fetch all EOD data for that date
      const { data: eodData, error: eodErr } = await marketDb
        .from('daily_stock_eod')
        .select('symbol, date, close, volume, category, sector, pe')
        .eq('date', latestDate);

      if (eodErr) {
        results.errors.push(`Failed to fetch EOD data: ${eodErr.message}`);
      } else if (eodData && eodData.length > 0) {
        // Get all securities from local DB to map symbol → isin
        const { data: securities } = await localDb
          .from('securities')
          .select('isin, security_code');

        const codeToIsin: Record<string, string> = {};
        for (const s of securities ?? []) {
          if (s.security_code) {
            codeToIsin[s.security_code.toUpperCase()] = s.isin;
          }
        }

        // Prepare daily_prices rows
        const priceRows = [];
        for (const eod of eodData) {
          const isin = codeToIsin[eod.symbol?.toUpperCase()];
          if (!isin) continue; // Skip symbols not in our securities table

          priceRows.push({
            isin,
            date: eod.date,
            close_price: eod.close,
            volume: eod.volume,
            source: 'DSE',
          });
        }

        if (priceRows.length > 0) {
          // Batch upsert into daily_prices
          const BATCH = 500;
          for (let i = 0; i < priceRows.length; i += BATCH) {
            const batch = priceRows.slice(i, i + BATCH);
            const { error: upsertErr } = await localDb
              .from('daily_prices')
              .upsert(batch, { onConflict: 'isin,date' });

            if (upsertErr) {
              results.errors.push(`daily_prices upsert batch ${i}: ${upsertErr.message}`);
            } else {
              results.prices_synced += batch.length;
            }
          }
        }

        // Also update last_close_price on securities table
        for (const eod of eodData) {
          const isin = codeToIsin[eod.symbol?.toUpperCase()];
          if (!isin) continue;

          await localDb
            .from('securities')
            .update({ last_close_price: eod.close })
            .eq('isin', isin);
        }
      }
    }

    return new Response(
      JSON.stringify(results),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
