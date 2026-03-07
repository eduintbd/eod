/**
 * Run marginability classification on both projects.
 */
import { createClient } from '@supabase/supabase-js';
import { MAIN_URL, MAIN_KEY } from './lib/env.mjs';

const projects = [
  {
    name: 'Main project',
    client: createClient(MAIN_URL, MAIN_KEY),
    hasMarginabilityUpdatedAt: true,
  },
];

const minFFMC = 500;
const maxPE = 30;
const peMultiplier = 2;

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function classify(sec, sectorMedians) {
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
    const div = sec.annual_dividend_pct;
    if (div === null || div === undefined || div < 5)
      return { is_marginable: false, reason: `B-category requires >= 5% annual dividend (current: ${div ?? 'not set'})` };
  }
  if (sec.trailing_pe === null || sec.trailing_pe <= 0)
    return { is_marginable: false, reason: `Negative or missing EPS (P/E: ${sec.trailing_pe ?? 'NULL'})` };
  if (sec.trailing_pe > maxPE)
    return { is_marginable: false, reason: `Trailing P/E (${sec.trailing_pe}) exceeds max (${maxPE})` };
  if (sec.sector && sectorMedians[sec.sector]) {
    const limit = peMultiplier * sectorMedians[sec.sector];
    if (sec.trailing_pe > limit)
      return { is_marginable: false, reason: `P/E (${sec.trailing_pe}) exceeds ${peMultiplier}x sectoral median` };
  }
  if (sec.free_float_market_cap === null || sec.free_float_market_cap < minFFMC)
    return { is_marginable: false, reason: `Free float market cap (${sec.free_float_market_cap ?? 'NULL'} mn) below ${minFFMC} mn` };
  return { is_marginable: true, reason: 'Meets all BSEC marginability criteria' };
}

for (const proj of projects) {
  console.log(`\n=== ${proj.name} ===`);

  // Fetch with columns we know exist on both
  const { data: securities, error: secErr } = await proj.client.from('securities')
    .select('isin, security_code, category, board, sector, trailing_pe, free_float_market_cap, status, asset_class');

  if (secErr) {
    console.log(`  Error fetching securities: ${secErr.message}`);
    continue;
  }
  if (!securities || securities.length === 0) {
    console.log('  No securities found');
    continue;
  }

  // Sectoral median P/E
  const sectorPEs = {};
  for (const s of securities) {
    if (s.sector && s.trailing_pe > 0) {
      if (!sectorPEs[s.sector]) sectorPEs[s.sector] = [];
      sectorPEs[s.sector].push(s.trailing_pe);
    }
  }
  const sectorMedians = {};
  for (const [sector, values] of Object.entries(sectorPEs)) {
    sectorMedians[sector] = median(values);
  }

  const reasons = {};
  let marginable = 0;
  const now = new Date().toISOString();
  const BATCH = 50;
  const updates = [];

  for (const sec of securities) {
    // annual_dividend_pct may not exist on new project — treat as null
    sec.annual_dividend_pct = sec.annual_dividend_pct ?? null;
    const result = classify(sec, sectorMedians);
    if (result.is_marginable) marginable++;
    else {
      const short = result.reason.substring(0, 60);
      reasons[short] = (reasons[short] || 0) + 1;
    }
    updates.push({ isin: sec.isin, is_marginable: result.is_marginable, reason: result.reason });
  }

  // Batch update
  for (let i = 0; i < updates.length; i += BATCH) {
    const batch = updates.slice(i, i + BATCH);
    await Promise.all(batch.map(u => {
      const upd = {
        is_marginable: u.is_marginable,
        marginability_reason: u.reason,
      };
      if (proj.hasMarginabilityUpdatedAt) upd.marginability_updated_at = now;
      return proj.client.from('securities').update(upd).eq('isin', u.isin);
    }));
  }

  console.log(`  Total: ${securities.length}`);
  console.log(`  Marginable: ${marginable}`);
  console.log(`  Non-marginable: ${securities.length - marginable}`);
  console.log('  Top reasons:');
  Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([r, c]) => console.log(`    ${c}x ${r}`));
}
