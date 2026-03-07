import { createClient } from '@supabase/supabase-js';
import { MAIN_URL, MAIN_KEY, SOURCE_URL, SOURCE_KEY } from './lib/env.mjs';

const main = createClient(MAIN_URL, MAIN_KEY, { auth: { persistSession: false } });
const pub = createClient(SOURCE_URL, SOURCE_KEY);

const DATES = ['2026-01-12', '2026-01-13'];

// Load local securities for symbol → isin mapping
const { data: secs } = await main.from('securities').select('isin, security_code');
const codeToIsin = {};
for (const s of secs || []) {
  if (s.security_code) codeToIsin[s.security_code.toUpperCase()] = s.isin;
}
console.log(`Loaded ${Object.keys(codeToIsin).length} securities for mapping`);

for (const targetDate of DATES) {
  console.log(`\n=== Syncing ${targetDate} ===`);

  // Fetch from public.price_history
  const { data: phData, error: phErr } = await pub.from('price_history')
    .select('symbol, trade_date, open, high, low, close, volume')
    .eq('trade_date', targetDate);

  if (phErr) { console.log('ERROR:', phErr.message); continue; }
  console.log(`  Source: ${phData.length} stocks`);

  // Map to daily_prices rows
  const priceRows = phData
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

  console.log(`  Matched: ${priceRows.length} (${phData.length - priceRows.length} no ISIN match)`);

  // Upsert in batches
  let synced = 0;
  for (let i = 0; i < priceRows.length; i += 500) {
    const batch = priceRows.slice(i, i + 500);
    const { error: upErr } = await main.from('daily_prices').upsert(batch, { onConflict: 'isin,date' });
    if (upErr) { console.log('  UPSERT ERROR:', upErr.message); break; }
    synced += batch.length;
  }
  console.log(`  Synced: ${synced} rows`);

  // Update last_close_price on securities
  let priceUpdated = 0;
  const matched = phData.filter(p => codeToIsin[p.symbol?.toUpperCase()]);
  for (let i = 0; i < matched.length; i += 50) {
    const batch = matched.slice(i, i + 50);
    await Promise.all(batch.map(p =>
      main.from('securities').update({ last_close_price: p.close }).eq('isin', codeToIsin[p.symbol.toUpperCase()])
    ));
    priceUpdated += batch.length;
  }
  console.log(`  Updated last_close_price on ${priceUpdated} securities`);
}

// Final check
const { count } = await main.from('daily_prices').select('*', { count: 'exact', head: true });
const { data: dates } = await main.from('daily_prices').select('date').order('date');
const unique = [...new Set((dates || []).map(d => d.date))];
console.log(`\n=== Done ===`);
console.log(`Total daily_prices: ${count} rows`);
console.log(`Dates available: ${unique.join(', ')}`);
