/**
 * Bulk-enrich local securities table from source project's stock_fundamentals + daily_stock_eod.
 * Also sets board = 'PUBLIC' for standard categories (A, B, Z, N).
 *
 * This replaces the slow per-symbol DSE scraping for the core fields.
 * Only free_float_market_cap still needs DSE scraping (uses market_cap as fallback).
 */
import { createClient } from '@supabase/supabase-js';
import { MAIN_URL, MAIN_KEY, SOURCE_URL, SOURCE_KEY } from './lib/env.mjs';

const local = createClient(MAIN_URL, MAIN_KEY);

const source = createClient(SOURCE_URL, SOURCE_KEY, { db: { schema: 'dse_market_data' } });

// Step 1: Load source data
console.log('Loading stock_fundamentals from source...');
const { data: fundamentals, error: fundErr } = await source.from('stock_fundamentals')
  .select('symbol, market_cap, face_value, pe, eps, sector, category, total_shares, listing_year, year_high, year_low');
if (fundErr) { console.error('Failed to load fundamentals:', fundErr.message); process.exit(1); }
console.log(`  Loaded ${fundamentals.length} rows from stock_fundamentals`);

// Build lookup by symbol
const fundBySymbol = {};
for (const f of fundamentals) {
  if (f.symbol) fundBySymbol[f.symbol.toUpperCase()] = f;
}

// Step 2: Load latest EOD for pe/category fallback
const { data: dateRow } = await source.from('daily_stock_eod').select('date').order('date', { ascending: false }).limit(1).single();
const { data: eodRows } = await source.from('daily_stock_eod')
  .select('symbol, category, sector, pe')
  .eq('date', dateRow.date);
console.log(`  Loaded ${eodRows.length} EOD rows for ${dateRow.date}`);

const eodBySymbol = {};
for (const e of eodRows) {
  if (e.symbol) eodBySymbol[e.symbol.toUpperCase()] = e;
}

// Step 3: Load local securities
const { data: securities, error: secErr } = await local.from('securities')
  .select('isin, security_code, category, board, sector, trailing_pe, free_float_market_cap, face_value');
if (secErr) { console.error('Failed to load local securities:', secErr.message); process.exit(1); }
console.log(`\nLocal securities: ${securities.length}`);

// Step 4: Match and update
let updated = 0, skipped = 0, noMatch = 0, errors = 0;

for (const sec of securities) {
  const code = (sec.security_code || '').toUpperCase();
  const fund = fundBySymbol[code];
  const eod = eodBySymbol[code];

  if (!fund && !eod) {
    noMatch++;
    continue;
  }

  const updates = {};

  // Category: prefer fundamentals, fallback to EOD
  const newCat = fund?.category || eod?.category || null;
  if (newCat && !sec.category) updates.category = newCat;

  // Sector
  const newSector = fund?.sector || eod?.sector || null;
  if (newSector && !sec.sector) updates.sector = newSector;

  // Trailing P/E: prefer fundamentals, fallback to EOD
  const newPE = fund?.pe || eod?.pe || null;
  if (newPE != null && newPE > 0 && sec.trailing_pe == null) updates.trailing_pe = newPE;

  // Face value
  if (fund?.face_value != null && sec.face_value == null) updates.face_value = fund.face_value;

  // Market cap as fallback for free_float_market_cap
  if (fund?.market_cap != null && sec.free_float_market_cap == null) {
    updates.free_float_market_cap = fund.market_cap;
  }

  // Board: set 'PUBLIC' for standard categories (A, B, Z, N)
  // SME stocks (category S) already have SPUBLIC
  const effectiveCat = updates.category || sec.category;
  if (!sec.board && effectiveCat) {
    if (['A', 'B', 'Z', 'N'].includes(effectiveCat)) {
      updates.board = 'PUBLIC';
    }
  }

  if (Object.keys(updates).length === 0) {
    skipped++;
    continue;
  }

  const { error: upErr } = await local.from('securities').update(updates).eq('isin', sec.isin);
  if (upErr) {
    errors++;
    console.error(`  Error updating ${code}:`, upErr.message);
  } else {
    updated++;
  }
}

console.log(`\nResults:`);
console.log(`  Updated: ${updated}`);
console.log(`  Skipped (no changes needed): ${skipped}`);
console.log(`  No match in source: ${noMatch}`);
console.log(`  Errors: ${errors}`);

// Step 5: Post-update stats
const { data: postCheck } = await local.from('securities')
  .select('category, board, trailing_pe, free_float_market_cap');

let nullCat = 0, nullBoard = 0, nullPE = 0, nullFFMC = 0;
for (const s of postCheck || []) {
  if (!s.category) nullCat++;
  if (!s.board) nullBoard++;
  if (s.trailing_pe == null || s.trailing_pe <= 0) nullPE++;
  if (s.free_float_market_cap == null) nullFFMC++;
}
console.log(`\nPost-update field coverage (${postCheck.length} securities):`);
console.log(`  NULL category: ${nullCat}`);
console.log(`  NULL board: ${nullBoard}`);
console.log(`  NULL/<=0 PE: ${nullPE}`);
console.log(`  NULL FFMC: ${nullFFMC}`);
