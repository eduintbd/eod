/**
 * Run marginability classification locally (avoids edge function timeout).
 * Same logic as classify-marginability edge function.
 */
import { createClient } from '@supabase/supabase-js';
import { MAIN_URL, MAIN_KEY } from './lib/env.mjs';

const db = createClient(MAIN_URL, MAIN_KEY);

// Load margin_config
const { data: configRows } = await db.from('margin_config').select('key, value');
const config = {};
for (const r of configRows || []) config[r.key] = r.value;
const minFFMC = config.min_ffmc_mn || 500;
const maxPE = config.max_trailing_pe || 30;
const peMultiplier = config.sectoral_pe_multiplier || 2;

console.log('Config:', { minFFMC, maxPE, peMultiplier });

// Load all securities
const { data: securities } = await db.from('securities')
  .select('isin, security_code, category, board, sector, trailing_pe, free_float_market_cap, annual_dividend_pct, status, asset_class');

console.log(`Securities: ${securities.length}`);

// Compute sectoral median P/E
const sectorPEs = {};
for (const s of securities) {
  if (s.sector && s.trailing_pe > 0) {
    if (!sectorPEs[s.sector]) sectorPEs[s.sector] = [];
    sectorPEs[s.sector].push(s.trailing_pe);
  }
}
const sectorMedians = {};
for (const [sector, values] of Object.entries(sectorPEs)) {
  const sorted = values.sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  sectorMedians[sector] = sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

// Classify
const reasons = {};
let marginable = 0;

function classify(sec) {
  if (!sec.category || ['N', 'Z', 'G', 'S'].includes(sec.category))
    return { is_marginable: false, reason: `Category '${sec.category || 'NULL'}' is not marginable` };
  if (sec.status === 'suspended')
    return { is_marginable: false, reason: 'Security is suspended' };
  if (!sec.board || sec.board !== 'PUBLIC')
    return { is_marginable: false, reason: `Board '${sec.board || 'NULL'}' — only Main Board (PUBLIC) is marginable` };
  if (sec.asset_class === 'MF')
    return { is_marginable: false, reason: 'Mutual fund securities are not marginable' };
  if (!['A', 'B'].includes(sec.category))
    return { is_marginable: false, reason: `Category '${sec.category}' — only A and B are marginable` };
  if (sec.category === 'B') {
    if (sec.annual_dividend_pct == null || sec.annual_dividend_pct < 5)
      return { is_marginable: false, reason: `B-category requires >= 5% annual dividend (current: ${sec.annual_dividend_pct ?? 'not set'})` };
  }
  if (sec.trailing_pe == null || sec.trailing_pe <= 0)
    return { is_marginable: false, reason: `Negative or missing EPS (P/E: ${sec.trailing_pe ?? 'NULL'})` };
  if (sec.trailing_pe > maxPE)
    return { is_marginable: false, reason: `Trailing P/E (${sec.trailing_pe}) exceeds max (${maxPE})` };
  if (sec.sector && sectorMedians[sec.sector]) {
    const limit = peMultiplier * sectorMedians[sec.sector];
    if (sec.trailing_pe > limit)
      return { is_marginable: false, reason: `P/E (${sec.trailing_pe}) exceeds ${peMultiplier}x sectoral median (${sectorMedians[sec.sector].toFixed(2)}, limit: ${limit.toFixed(2)})` };
  }
  if (sec.free_float_market_cap == null || sec.free_float_market_cap < minFFMC)
    return { is_marginable: false, reason: `Free float market cap (${sec.free_float_market_cap ?? 'NULL'} mn) below ${minFFMC} mn` };
  return { is_marginable: true, reason: 'Meets all BSEC marginability criteria' };
}

const now = new Date().toISOString();
let updateCount = 0;
const BATCH = 50;
const updates = [];

for (const sec of securities) {
  const result = classify(sec);
  if (result.is_marginable) marginable++;
  else {
    const short = result.reason.substring(0, 50);
    reasons[short] = (reasons[short] || 0) + 1;
  }
  updates.push({ isin: sec.isin, is_marginable: result.is_marginable, reason: result.reason });
}

// Batch update
for (let i = 0; i < updates.length; i += BATCH) {
  const batch = updates.slice(i, i + BATCH);
  const promises = batch.map(u =>
    db.from('securities').update({
      is_marginable: u.is_marginable,
      marginability_reason: u.reason,
      marginability_updated_at: now,
    }).eq('isin', u.isin)
  );
  await Promise.all(promises);
  updateCount += batch.length;
}

console.log(`\nClassification complete:`);
console.log(`  Marginable: ${marginable}`);
console.log(`  Non-marginable: ${securities.length - marginable}`);
console.log(`  Updated: ${updateCount}`);
console.log(`\nRejection reasons:`);
Object.entries(reasons).sort((a, b) => b[1] - a[1]).forEach(([r, c]) => console.log(`  ${c}x ${r}`));
