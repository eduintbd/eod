/**
 * Sync fundamentals from source (ucb csm) → main project.
 * Fills category, sector, PE, face_value, market_cap, board on securities.
 */
import { createClient } from '@supabase/supabase-js';
import { MAIN_URL, MAIN_KEY, SOURCE_URL, SOURCE_KEY } from './lib/env.mjs';

const source = createClient(SOURCE_URL, SOURCE_KEY, { db: { schema: 'dse_market_data' } });
const sourcePub = createClient(SOURCE_URL, SOURCE_KEY);
const main = createClient(MAIN_URL, MAIN_KEY);

// Load source data
console.log('=== Loading source data ===');
const { data: fundamentals } = await source.from('stock_fundamentals')
  .select('symbol, market_cap, face_value, pe, sector, category');
console.log(`  stock_fundamentals: ${fundamentals?.length} rows`);

const { data: stocks } = await sourcePub.from('stocks').select('symbol, category, sector');
console.log(`  public.stocks: ${stocks?.length} rows`);

const fundMap = {};
for (const f of fundamentals || []) { if (f.symbol) fundMap[f.symbol.toUpperCase()] = f; }
const stockMap = {};
for (const s of stocks || []) { if (s.symbol) stockMap[s.symbol.toUpperCase()] = s; }

// Load main project securities
const { data: mainSecs } = await main.from('securities')
  .select('isin, security_code, category, board, sector, trailing_pe, free_float_market_cap, face_value');
console.log(`  Main securities: ${mainSecs?.length}`);

console.log('\n=== Syncing source → main ===');
let updated = 0, skipped = 0, noMatch = 0, errors = 0;

for (const sec of mainSecs || []) {
  const code = (sec.security_code || '').toUpperCase();
  const fund = fundMap[code];
  const stock = stockMap[code];
  if (!fund && !stock) { noMatch++; continue; }

  const updates = {};
  const newCat = stock?.category || fund?.category || null;
  if (newCat && newCat !== '-' && !sec.category) updates.category = newCat;
  const newSector = stock?.sector || fund?.sector || null;
  if (newSector && !sec.sector) updates.sector = newSector;
  if (fund?.pe > 0 && sec.trailing_pe == null) updates.trailing_pe = fund.pe;
  if (fund?.face_value != null && sec.face_value == null) updates.face_value = fund.face_value;
  if (fund?.market_cap != null && sec.free_float_market_cap == null) updates.free_float_market_cap = fund.market_cap;
  const effectiveCat = (updates.category || sec.category);
  if (!sec.board && effectiveCat && ['A', 'B', 'Z', 'N'].includes(effectiveCat)) updates.board = 'PUBLIC';

  if (Object.keys(updates).length === 0) { skipped++; continue; }

  const { error } = await main.from('securities').update(updates).eq('isin', sec.isin);
  if (error) { errors++; } else updated++;
}

console.log(`  Updated: ${updated}, Skipped: ${skipped}, No match: ${noMatch}, Errors: ${errors}`);

// Post-sync stats
const { data: check } = await main.from('securities')
  .select('category, board, sector, trailing_pe, free_float_market_cap');
let nc = 0, nb = 0, ns = 0, np = 0, nf = 0;
for (const s of check || []) {
  if (!s.category) nc++;
  if (!s.board) nb++;
  if (!s.sector) ns++;
  if (s.trailing_pe == null || s.trailing_pe <= 0) np++;
  if (s.free_float_market_cap == null) nf++;
}
console.log(`\nMain project (${check?.length} securities):`);
console.log(`  NULL category: ${nc}, NULL board: ${nb}, NULL sector: ${ns}`);
console.log(`  NULL/<=0 PE: ${np}, NULL FFMC: ${nf}`);
