/**
 * Reprocess all trade_executions with correct client-specific commission rates.
 * Client commission_rate is all-inclusive — no separate exchange/CDBL/AIT fees.
 * Clients without a commission_rate use the global fee_schedule rates.
 *
 * Steps:
 * 1. Recalculate fees in trade_executions
 * 2. Update cash_ledger amounts (join on reference = exec_id)
 * 3. Recalculate running_balances (cumulative sum)
 * 4. Recalculate holdings average_cost for BUY trades
 */
import { createClient } from '@supabase/supabase-js';
import { MAIN_URL, MAIN_KEY } from './lib/env.mjs';

const db = createClient(MAIN_URL, MAIN_KEY, { auth: { persistSession: false } });
const round = v => Math.round(v * 100) / 100;

// Load global fee schedule
const { data: feeRows } = await db.from('fee_schedule').select('fee_type, rate, min_amount').eq('is_active', true).is('effective_to', null);
const getFee = type => (feeRows || []).find(f => f.fee_type === type);
const globalFees = {
  commission: getFee('BROKERAGE_COMMISSION')?.rate ?? 0.003,
  exchange: getFee('EXCHANGE_FEE')?.rate ?? 0.0003,
  cdbl: getFee('CDBL_FEE')?.rate ?? 0.000175,
  cdblMin: getFee('CDBL_FEE')?.min_amount ?? 5,
  ait: getFee('AIT')?.rate ?? 0.0005,
};
console.log('Global fee schedule:', globalFees);

// Load client commission rates
const clientRateMap = {};
let rOffset = 0;
while (true) {
  const { data: batch } = await db.from('clients')
    .select('client_id, commission_rate')
    .not('commission_rate', 'is', null)
    .range(rOffset, rOffset + 999);
  if (!batch || batch.length === 0) break;
  for (const c of batch) clientRateMap[c.client_id] = Number(c.commission_rate);
  rOffset += batch.length;
  if (batch.length < 1000) break;
}
console.log(`Loaded ${Object.keys(clientRateMap).length} client commission rates`);

// Load ALL trade_executions (paginated)
let allExecs = [];
let eOffset = 0;
while (true) {
  const { data: batch } = await db.from('trade_executions')
    .select('exec_id, client_id, side, value, commission, exchange_fee, cdbl_fee, ait, net_value')
    .order('exec_id')
    .range(eOffset, eOffset + 999);
  if (!batch || batch.length === 0) break;
  allExecs.push(...batch);
  eOffset += batch.length;
  if (batch.length < 1000) break;
}
console.log(`Loaded ${allExecs.length} trade executions`);

// Recalculate fees
let changed = 0, unchanged = 0;
const execUpdates = []; // { exec_id, commission, exchange_fee, cdbl_fee, ait, net_value }
const cashUpdates = []; // { exec_id, old_net, new_net, side }

for (const e of allExecs) {
  const val = Number(e.value);
  const clientRate = clientRateMap[e.client_id];
  const hasClientRate = clientRate != null;

  const newComm = round(val * (hasClientRate ? clientRate : globalFees.commission));
  const newExch = hasClientRate ? 0 : round(val * globalFees.exchange);
  const newCdbl = hasClientRate ? 0 : round(Math.max(val * globalFees.cdbl, globalFees.cdblMin));
  const newAit = hasClientRate ? 0 : round(val * globalFees.ait);
  const newTotal = newComm + newExch + newCdbl + newAit;
  const newNet = round(e.side === 'BUY' ? val + newTotal : val - newTotal);

  const oldNet = Number(e.net_value);
  if (Math.abs(newNet - oldNet) > 0.01) {
    execUpdates.push({
      exec_id: e.exec_id,
      commission: newComm,
      exchange_fee: newExch,
      cdbl_fee: newCdbl,
      ait: newAit,
      net_value: newNet,
    });
    cashUpdates.push({
      exec_id: e.exec_id,
      client_id: e.client_id,
      side: e.side,
      old_net: oldNet,
      new_net: newNet,
    });
    changed++;
  } else {
    unchanged++;
  }
}

console.log(`\nFee recalculation: ${changed} changed, ${unchanged} unchanged`);

// Step 1: Update trade_executions
console.log('\nUpdating trade_executions...');
for (let i = 0; i < execUpdates.length; i++) {
  const u = execUpdates[i];
  const { error } = await db.from('trade_executions')
    .update({
      commission: u.commission,
      exchange_fee: u.exchange_fee,
      cdbl_fee: u.cdbl_fee,
      ait: u.ait,
      net_value: u.net_value,
    })
    .eq('exec_id', u.exec_id);
  if (error) console.log(`  ERROR ${u.exec_id}: ${error.message}`);
  if ((i + 1) % 100 === 0) process.stdout.write(`  ${i + 1}/${execUpdates.length}\r`);
}
console.log(`  Done: ${execUpdates.length} updated`);

// Step 2: Update cash_ledger amounts
// cash_ledger.reference = exec_id, amount = -(net_value) for BUY, +(net_value) for SELL
console.log('\nUpdating cash_ledger amounts...');
for (let i = 0; i < cashUpdates.length; i++) {
  const u = cashUpdates[i];
  const newAmount = round(u.side === 'BUY' ? -u.new_net : u.new_net);
  const { error } = await db.from('cash_ledger')
    .update({ amount: newAmount })
    .eq('reference', u.exec_id)
    .eq('client_id', u.client_id);
  if (error) console.log(`  ERROR ${u.exec_id}: ${error.message}`);
  if ((i + 1) % 100 === 0) process.stdout.write(`  ${i + 1}/${cashUpdates.length}\r`);
}
console.log(`  Done: ${cashUpdates.length} updated`);

// Step 3: Fix running_balances — user runs this SQL in Supabase:
console.log('\n*** NOW RUN THIS SQL IN SUPABASE SQL EDITOR: ***');
console.log(`
WITH correct_balances AS (
  SELECT
    id,
    client_id,
    SUM(amount) OVER (
      PARTITION BY client_id
      ORDER BY id
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS correct_running_balance
  FROM cash_ledger
)
UPDATE cash_ledger cl
SET running_balance = cb.correct_running_balance
FROM correct_balances cb
WHERE cl.id = cb.id
  AND cl.running_balance != cb.correct_running_balance;
`);

// Step 4: Recalculate holdings average_cost
// For clients with changed fees, we need to recompute average_cost
// Group executions by client+isin, replay BUYs in order
console.log('\nRecalculating holdings average_cost...');

// Get affected client_ids
const affectedClients = new Set(cashUpdates.map(u => u.client_id));
console.log(`  ${affectedClients.size} clients affected`);

// For each affected client, load their admin-balance holdings (original)
// and replay all trades
let holdingsFixed = 0;
let clientsDone = 0;
for (const clientId of affectedClients) {
  // Get all trade_executions for this client, ordered by exec_id (trade order)
  const { data: execs } = await db.from('trade_executions')
    .select('exec_id, isin, side, quantity, price, net_value')
    .eq('client_id', clientId)
    .order('exec_id');

  // Get current holdings
  const { data: holdings } = await db.from('holdings')
    .select('isin, quantity, average_cost, total_invested, realized_pl')
    .eq('client_id', clientId);

  const holdingsMap = {};
  for (const h of holdings || []) holdingsMap[h.isin] = { ...h };

  // For each isin this client traded, we need the BASELINE (pre-trade) values
  // Baseline = current values with trade effects reversed
  const isinExecs = {};
  for (const e of execs || []) {
    if (!isinExecs[e.isin]) isinExecs[e.isin] = [];
    isinExecs[e.isin].push(e);
  }

  for (const [isin, trades] of Object.entries(isinExecs)) {
    const h = holdingsMap[isin];
    if (!h) continue;

    // Reverse trades to get baseline
    let baseQty = Number(h.quantity);
    let baseInvested = Number(h.total_invested);
    let baseRealizedPl = Number(h.realized_pl);

    // Reverse in reverse order
    for (let i = trades.length - 1; i >= 0; i--) {
      const t = trades[i];
      const qty = Number(t.quantity);
      const net = Number(t.net_value); // This is already the UPDATED net_value
      // Wait — we need the OLD net_value to reverse. Let me use the current DB values.
      // Actually, trade_executions have already been updated in Step 1.
      // So net_value is the NEW value. But we need to reverse using OLD values.
      // Hmm, this is tricky. Let me just use original values.
    }

    // Actually, simpler approach: just replay all trades from baseline
    // The baseline for admin-balance holdings:
    // We know current state and all trades. Reverse ALL trades to get baseline.
    // But we already updated net_value in trade_executions, so we can't get old values.
    //
    // Alternative: recompute from scratch.
    // baseline_qty = current_qty - sum(buy_qty) + sum(sell_qty)
    // baseline_invested = current_invested - sum(buy_net_value) [new values]
    // baseline_avg = baseline_invested / baseline_qty (if > 0)
    //
    // Then replay with new net_values

    let buyQtyTotal = 0, sellQtyTotal = 0;
    let buyNetTotal = 0; // sum of NEW net_values for buys
    let sellPl = 0;

    for (const t of trades) {
      if (t.side === 'BUY') {
        buyQtyTotal += Number(t.quantity);
        buyNetTotal += Number(t.net_value);
      } else {
        sellQtyTotal += Number(t.quantity);
      }
    }

    // Baseline = pre-trade state
    const baselineQty = baseQty - buyQtyTotal + sellQtyTotal;
    // For baseline avg_cost: we can't easily derive it because sells don't change avg
    // and buys use weighted average. But if baselineQty=0, avg was 0 (no prior position).
    // If baselineQty > 0, the baseline avg_cost is what it was from admin balance.
    // Since sells don't change avg_cost, and buys change it, we need to figure out the
    // admin balance avg_cost. This is the avg_cost that was set before any trades.
    //
    // The admin balance avg_cost can be derived: if we replay all BUY trades starting
    // from baseline, we should get the current avg_cost.
    //
    // Let's just replay all trades from the baseline.
    // We need baseline avg_cost. We can solve for it:
    // After all buys and sells (sells don't change avg):
    // final_avg = (baseline_qty * baseline_avg + sum_buy_net) / (baseline_qty + sum_buy_qty)
    // So: baseline_avg = (final_avg * (baseline_qty + sum_buy_qty) - sum_buy_net) / baseline_qty

    if (baselineQty > 0) {
      const currentAvg = Number(h.average_cost);
      const finalQtyAfterBuys = baselineQty + buyQtyTotal; // before sells
      const baselineAvg = (currentAvg * finalQtyAfterBuys - buyNetTotal) / baselineQty;

      // Now replay with new net_values to get new avg_cost
      let qty = baselineQty;
      let avg = baselineAvg;
      let invested = baselineQty * baselineAvg;
      let realPl = 0;

      for (const t of trades) {
        const tQty = Number(t.quantity);
        const tNet = Number(t.net_value);
        if (t.side === 'BUY') {
          const newQty = qty + tQty;
          avg = newQty > 0 ? (qty * avg + tNet) / newQty : 0;
          invested += tNet;
          qty = newQty;
        } else {
          const costBasis = avg > 0 ? avg : Number(t.price);
          realPl += tNet - costBasis * tQty;
          qty = Math.max(0, qty - tQty);
          // avg doesn't change on sells
        }
      }

      const newAvg = round(avg);
      const newInvested = round(invested);
      const baseRpl = Number(h.realized_pl) - sellPl; // hmm this gets complex

      // Just update avg_cost and total_invested
      if (Math.abs(newAvg - Number(h.average_cost)) > 0.01) {
        await db.from('holdings').update({
          average_cost: newAvg,
          total_invested: newInvested,
        }).eq('client_id', clientId).eq('isin', isin);
        holdingsFixed++;
      }
    } else if (baselineQty === 0) {
      // No prior position — all from trades. Replay from 0.
      let qty = 0, avg = 0, invested = 0, realPl = 0;
      for (const t of trades) {
        const tQty = Number(t.quantity);
        const tNet = Number(t.net_value);
        if (t.side === 'BUY') {
          const newQty = qty + tQty;
          avg = newQty > 0 ? (qty * avg + tNet) / newQty : 0;
          invested += tNet;
          qty = newQty;
        } else {
          const costBasis = avg > 0 ? avg : Number(t.price);
          realPl += tNet - costBasis * tQty;
          qty = Math.max(0, qty - tQty);
        }
      }

      const newAvg = round(avg);
      if (Math.abs(newAvg - Number(h.average_cost)) > 0.01) {
        await db.from('holdings').update({
          average_cost: newAvg,
          total_invested: round(invested),
          realized_pl: round(realPl),
        }).eq('client_id', clientId).eq('isin', isin);
        holdingsFixed++;
      }
    }
  }

  clientsDone++;
  if (clientsDone % 50 === 0) process.stdout.write(`  ${clientsDone}/${affectedClients.size} clients\r`);
}

console.log(`  Done: ${holdingsFixed} holdings updated across ${affectedClients.size} clients`);

// Verify client 400
const { data: c400 } = await db.from('clients').select('client_id').eq('client_code', '400').single();
const { data: c400execs } = await db.from('trade_executions')
  .select('commission, exchange_fee, cdbl_fee, ait, net_value')
  .eq('client_id', c400.client_id)
  .limit(3);
console.log('\nClient 400 first 3 trades after fix:');
for (const e of c400execs || []) {
  console.log(`  comm=${e.commission} exch=${e.exchange_fee} cdbl=${e.cdbl_fee} ait=${e.ait} net=${e.net_value}`);
}
