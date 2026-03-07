/**
 * Local trade processor — same logic as process-trades edge function
 * but pre-loads lookups for speed. Processes all unprocessed FILL/PF trades.
 */
import { createClient } from '@supabase/supabase-js';
import { MAIN_URL, MAIN_KEY } from './lib/env.mjs';

const db = createClient(MAIN_URL, MAIN_KEY, { auth: { persistSession: false } });
const round = v => Math.round(v * 100) / 100;

// ── Fee schedule ──
const { data: feeRows } = await db.from('fee_schedule').select('fee_type, rate, min_amount').eq('is_active', true).is('effective_to', null);
const getFee = type => (feeRows || []).find(f => f.fee_type === type);
const fees = {
  commission: getFee('BROKERAGE_COMMISSION')?.rate ?? 0.003,
  exchange: getFee('EXCHANGE_FEE')?.rate ?? 0.0003,
  cdbl: getFee('CDBL_FEE')?.rate ?? 0.000175,
  cdblMin: getFee('CDBL_FEE')?.min_amount ?? 5,
  ait: getFee('AIT')?.rate ?? 0.0005,
};
console.log('Fee schedule:', fees);

function calcFees(value, side) {
  const comm = value * fees.commission;
  const exch = value * fees.exchange;
  const cdbl = Math.max(value * fees.cdbl, fees.cdblMin);
  const ait = value * fees.ait;
  const total = comm + exch + cdbl + ait;
  const net = side === 'BUY' ? value + total : value - total;
  return { commission: round(comm), exchange_fee: round(exch), cdbl_fee: round(cdbl), ait: round(ait), total_fees: round(total), net_value: round(net) };
}

function addBizDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  let added = 0;
  while (added < days) { d.setDate(d.getDate() + 1); const dow = d.getDay(); if (dow !== 5 && dow !== 6) added++; }
  return d.toISOString().split('T')[0];
}

function settlementDate(tradeDate, category, side, isSpot) {
  if (isSpot) return addBizDays(tradeDate, side === 'SELL' ? 0 : 1);
  if (category === 'Z') return addBizDays(tradeDate, 3);
  return addBizDays(tradeDate, 2);
}

// ── Pre-load lookups ──
console.log('Loading lookups...');
const { data: clients } = await db.from('clients').select('client_id, bo_id, client_code');
const boMap = {}, codeMap = {};
for (const c of clients || []) {
  if (c.bo_id) boMap[c.bo_id] = c.client_id;
  if (c.client_code) codeMap[c.client_code] = c.client_id;
}
console.log(`  ${clients?.length} clients`);

const { data: securities } = await db.from('securities').select('isin, security_code');
const secByCode = {}, secByIsin = {};
for (const s of securities || []) {
  if (s.security_code) secByCode[s.security_code] = s.isin;
  secByIsin[s.isin] = s.isin;
}
console.log(`  ${securities?.length} securities`);

const { data: existingExecs } = await db.from('trade_executions').select('exec_id');
const execSet = new Set((existingExecs || []).map(e => e.exec_id));
console.log(`  ${execSet.size} existing executions`);

// Load holdings and cash_ledger latest per client
const { data: allHoldings } = await db.from('holdings').select('client_id, isin, quantity, average_cost, total_invested, realized_pl');
const holdingsMap = {};
for (const h of allHoldings || []) {
  const key = `${h.client_id}|${h.isin}`;
  holdingsMap[key] = { ...h };
}
console.log(`  ${allHoldings?.length} holdings`);

const { data: allLedger } = await db.from('cash_ledger').select('client_id, running_balance').order('id', { ascending: false });
const cashMap = {};
for (const l of allLedger || []) {
  if (!cashMap[l.client_id]) cashMap[l.client_id] = Number(l.running_balance);
}
console.log(`  ${Object.keys(cashMap).length} cash balances`);

// ── Load unprocessed trades ──
let allTrades = [];
let offset = 0;
while (true) {
  const { data: batch } = await db.from('raw_trades')
    .select('*')
    .eq('processed', false)
    .in('status', ['FILL', 'PF'])
    .gt('quantity', 0)
    .order('id')
    .range(offset, offset + 999);
  if (!batch || batch.length === 0) break;
  allTrades.push(...batch);
  offset += batch.length;
  if (batch.length < 1000) break;
}
console.log(`\nProcessing ${allTrades.length} trades...`);

let processed = 0, failed = 0, skipped = 0;
const BATCH = 50;

for (let i = 0; i < allTrades.length; i += BATCH) {
  const batch = allTrades.slice(i, i + BATCH);
  const execInserts = [];
  const holdingUpserts = [];
  const cashInserts = [];
  const markProcessed = [];
  const markFailed = [];

  for (const raw of batch) {
    try {
      if (!raw.exec_id || execSet.has(raw.exec_id)) {
        markProcessed.push(raw.id);
        skipped++;
        continue;
      }

      // Resolve client
      let clientId = (raw.bo_id && boMap[raw.bo_id]) || (raw.client_code && codeMap[raw.client_code]) || null;
      if (!clientId) {
        // Create placeholder
        const { data: newC } = await db.from('clients').insert({
          bo_id: raw.bo_id || null,
          client_code: raw.client_code || `UNKNOWN-${raw.bo_id || raw.id}`,
          name: `Placeholder - ${raw.bo_id || raw.client_code}`,
          status: 'pending_review',
        }).select('client_id').single();
        if (newC) {
          clientId = newC.client_id;
          if (raw.bo_id) boMap[raw.bo_id] = clientId;
          if (raw.client_code) codeMap[raw.client_code] = clientId;
        } else {
          // Retry lookup
          const { data: retry } = await db.from('clients').select('client_id')
            .or(`bo_id.eq.${raw.bo_id},client_code.eq.${raw.client_code}`).single();
          clientId = retry?.client_id;
        }
      }
      if (!clientId) throw new Error(`No client for bo_id=${raw.bo_id}`);

      // Resolve security
      let isin = (raw.security_code && secByCode[raw.security_code]) || (raw.isin && secByIsin[raw.isin]) || null;
      if (!isin) {
        isin = raw.isin || `PLACEHOLDER-${raw.security_code || raw.id}`;
        await db.from('securities').insert({
          isin, security_code: raw.security_code || isin,
          company_name: raw.security_code || isin, asset_class: raw.asset_class || 'EQ',
          category: raw.category, board: raw.board, status: 'active',
        });
        secByCode[raw.security_code] = isin;
        secByIsin[isin] = isin;
      }

      const side = raw.side === 'B' ? 'BUY' : 'SELL';
      const tradeValue = Number(raw.value) || 0;
      const f = calcFees(tradeValue, side);
      const settDate = raw.trade_date ? settlementDate(raw.trade_date, raw.category, side, raw.compulsory_spot) : null;

      execInserts.push({
        exec_id: raw.exec_id, order_id: raw.order_id, client_id: clientId, isin,
        exchange: raw.source, side, quantity: raw.quantity, price: raw.price, value: tradeValue,
        trade_date: raw.trade_date, trade_time: raw.trade_time, settlement_date: settDate,
        session: raw.session, fill_type: raw.fill_type, category: raw.category, board: raw.board,
        commission: f.commission, exchange_fee: f.exchange_fee, cdbl_fee: f.cdbl_fee, ait: f.ait, net_value: f.net_value,
      });
      execSet.add(raw.exec_id);

      // Holdings calc
      const hKey = `${clientId}|${isin}`;
      const h = holdingsMap[hKey] || { quantity: 0, average_cost: 0, total_invested: 0, realized_pl: 0 };
      let newQty, newAvg, newInv, newPl;
      if (side === 'BUY') {
        newQty = h.quantity + raw.quantity;
        newAvg = newQty > 0 ? (h.quantity * h.average_cost + f.net_value) / newQty : 0;
        newInv = h.total_invested + f.net_value;
        newPl = h.realized_pl;
      } else {
        newQty = Math.max(0, h.quantity - raw.quantity);
        newAvg = h.average_cost;
        newInv = h.total_invested;
        const costBasis = h.average_cost > 0 ? h.average_cost : (Number(raw.price) || 0);
        newPl = h.realized_pl + (f.net_value - costBasis * raw.quantity);
      }
      holdingsMap[hKey] = { quantity: newQty, average_cost: round(newAvg), total_invested: round(newInv), realized_pl: round(newPl) };
      holdingUpserts.push({
        client_id: clientId, isin, quantity: newQty, average_cost: round(newAvg),
        total_invested: round(newInv), realized_pl: round(newPl), as_of_date: raw.trade_date,
      });

      // Cash ledger
      const prevBal = cashMap[clientId] ?? 0;
      const cashAmt = side === 'BUY' ? -f.net_value : f.net_value;
      const newBal = round(prevBal + cashAmt);
      cashMap[clientId] = newBal;
      cashInserts.push({
        client_id: clientId, transaction_date: raw.trade_date, value_date: settDate,
        amount: round(cashAmt), running_balance: newBal,
        type: side === 'BUY' ? 'BUY_TRADE' : 'SELL_TRADE',
        reference: raw.exec_id,
        narration: `${side} ${raw.quantity} ${raw.security_code || isin} @ ${raw.price}`,
      });

      markProcessed.push(raw.id);
      processed++;
    } catch (err) {
      markFailed.push({ id: raw.id, msg: err.message || String(err) });
      failed++;
    }
  }

  // Batch DB operations
  if (execInserts.length) {
    const { error } = await db.from('trade_executions').insert(execInserts);
    if (error) console.log('  exec insert error:', error.message);
  }
  if (holdingUpserts.length) {
    const { error } = await db.from('holdings').upsert(holdingUpserts, { onConflict: 'client_id,isin' });
    if (error) console.log('  holdings upsert error:', error.message);
  }
  if (cashInserts.length) {
    const { error } = await db.from('cash_ledger').insert(cashInserts);
    if (error) console.log('  cash insert error:', error.message);
  }
  if (markProcessed.length) {
    await db.from('raw_trades').update({ processed: true }).in('id', markProcessed);
  }
  for (const f of markFailed) {
    await db.from('raw_trades').update({ processed: false, error_message: f.msg }).eq('id', f.id);
  }

  process.stdout.write(`  ${Math.min(i + BATCH, allTrades.length)}/${allTrades.length} (${processed} ok, ${failed} err, ${skipped} skip)\r`);
}

console.log(`\n\n=== DONE ===`);
console.log(`Processed: ${processed} | Failed: ${failed} | Skipped: ${skipped}`);

const { count: teCount } = await db.from('trade_executions').select('*', { count: 'exact', head: true });
console.log(`Total trade_executions: ${teCount}`);
