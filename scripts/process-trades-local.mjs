#!/usr/bin/env node
/**
 * Local trade processor — parallel version
 * Fetches batches and processes trades concurrently (10 at a time)
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://zuupegtizrvbnsliuddu.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp1dXBlZ3RpenJ2Ym5zbGl1ZGR1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTg3ODE1NCwiZXhwIjoyMDg3NDU0MTU0fQ.fE4D9Y0mFGzY6NT2aqnA9MLQJqHVQRB5VGo6II0zKx0';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

const BATCH_SIZE = 100;
const CONCURRENCY = 10; // Process 10 trades simultaneously

// Fee calculation
async function loadFeeSchedule() {
  const { data } = await supabase.from('fee_schedule').select('*').eq('is_active', true).is('effective_to', null);
  return data || [];
}

function calculateFees(tradeValue, side, feeSchedule) {
  const getRate = (type) => {
    const entry = feeSchedule.find(f => f.fee_type === type);
    return entry ? Number(entry.rate) : 0;
  };
  const commissionRate = getRate('COMMISSION') || 0.003;
  const exchangeRate = getRate('EXCHANGE_FEE') || 0.0003;
  const cdblRate = getRate('CDBL_FEE') || 0.000175;
  const aitRate = getRate('AIT') || 0.0005;

  const commission = Math.round(tradeValue * commissionRate * 100) / 100;
  const exchangeFee = Math.round(tradeValue * exchangeRate * 100) / 100;
  const cdblFee = Math.max(5, Math.round(tradeValue * cdblRate * 100) / 100);
  const ait = Math.round(tradeValue * aitRate * 100) / 100;
  const totalFees = commission + exchangeFee + cdblFee + ait;
  const netValue = side === 'BUY'
    ? Math.round((tradeValue + totalFees) * 100) / 100
    : Math.round((tradeValue - totalFees) * 100) / 100;
  return { commission, exchange_fee: exchangeFee, cdbl_fee: cdblFee, ait, net_value: netValue };
}

function addBusinessDays(start, days) {
  const result = new Date(start);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();
    if (day !== 5 && day !== 6) added++;
  }
  return result.toISOString().split('T')[0];
}

function computeSettlementDate(tradeDate, category, side, isSpot) {
  const date = new Date(tradeDate + 'T00:00:00');
  if (isSpot) return addBusinessDays(date, side === 'SELL' ? 0 : 1);
  if (category === 'Z') return addBusinessDays(date, 3);
  return addBusinessDays(date, 2);
}

// Cache for client and security lookups
const clientCache = new Map();
const securityCache = new Map();

async function resolveClient(raw) {
  const key = raw.bo_id || raw.client_code;
  if (clientCache.has(key)) return clientCache.get(key);

  let clientId = null;
  if (raw.bo_id) {
    const { data: c } = await supabase.from('clients').select('client_id').eq('bo_id', raw.bo_id).single();
    clientId = c?.client_id ?? null;
  }
  if (!clientId && raw.client_code) {
    const { data: c } = await supabase.from('clients').select('client_id').eq('client_code', raw.client_code).single();
    clientId = c?.client_id ?? null;
  }
  if (!clientId) {
    const { data: newClient, error: createErr } = await supabase.from('clients')
      .insert({
        bo_id: raw.bo_id || null,
        client_code: raw.client_code || `UNKNOWN-${raw.bo_id || raw.id}`,
        name: `Placeholder - ${raw.bo_id || raw.client_code}`,
        status: 'pending_review',
      }).select('client_id').single();
    if (createErr) {
      const { data: retry } = await supabase.from('clients').select('client_id')
        .or(`bo_id.eq.${raw.bo_id},client_code.eq.${raw.client_code}`).single();
      clientId = retry?.client_id ?? null;
    } else {
      clientId = newClient?.client_id ?? null;
    }
  }
  if (clientId) clientCache.set(key, clientId);
  return clientId;
}

async function resolveSecurity(raw) {
  const key = raw.security_code || raw.isin;
  if (securityCache.has(key)) return securityCache.get(key);

  let isin = null;
  if (raw.security_code) {
    const { data: byCode } = await supabase.from('securities').select('isin').eq('security_code', raw.security_code).single();
    if (byCode) isin = byCode.isin;
  }
  if (!isin && raw.isin) {
    const { data: byIsin } = await supabase.from('securities').select('isin').eq('isin', raw.isin).single();
    if (byIsin) isin = byIsin.isin;
  }
  if (!isin) {
    isin = raw.isin || `PLACEHOLDER-${raw.security_code || raw.id}`;
    const code = raw.security_code || isin;
    const { error: secErr } = await supabase.from('securities').insert({
      isin, security_code: code, company_name: code,
      asset_class: raw.asset_class || 'EQ', category: raw.category, board: raw.board, status: 'active',
    });
    if (secErr) {
      const { data: retry } = await supabase.from('securities').select('isin').eq('security_code', code).single();
      isin = retry?.isin ?? isin;
    }
  }
  if (isin) securityCache.set(key, isin);
  return isin;
}

async function processSingleTrade(raw, feeSchedule, existingSet) {
  if (!raw.exec_id || existingSet.has(raw.exec_id)) {
    await supabase.from('raw_trades')
      .update({ processed: true, error_message: raw.exec_id ? 'Duplicate exec_id' : 'Missing exec_id' })
      .eq('id', raw.id);
    return 'skip';
  }

  const clientId = await resolveClient(raw);
  if (!clientId) throw new Error(`Cannot resolve client for bo_id=${raw.bo_id}`);

  const isin = await resolveSecurity(raw);
  if (!isin) throw new Error(`Cannot resolve security for ${raw.security_code}`);

  const side = raw.side === 'B' ? 'BUY' : 'SELL';
  const tradeValue = Number(raw.value) || 0;
  const fees = calculateFees(tradeValue, side, feeSchedule);
  const settlementDate = raw.trade_date
    ? computeSettlementDate(raw.trade_date, raw.category, side, raw.compulsory_spot)
    : null;

  // Insert trade execution
  const { error: insertErr } = await supabase.from('trade_executions').insert({
    exec_id: raw.exec_id, order_id: raw.order_id, client_id: clientId, isin,
    exchange: raw.source, side, quantity: raw.quantity, price: raw.price, value: tradeValue,
    trade_date: raw.trade_date, trade_time: raw.trade_time, settlement_date: settlementDate,
    session: raw.session, fill_type: raw.fill_type, category: raw.category, board: raw.board,
    commission: fees.commission, exchange_fee: fees.exchange_fee, cdbl_fee: fees.cdbl_fee,
    ait: fees.ait, net_value: fees.net_value,
  });
  if (insertErr) throw new Error(`Insert trade_execution: ${insertErr.message}`);
  existingSet.add(raw.exec_id);

  // Update holdings (must be sequential per client+isin to avoid race conditions)
  const { data: currentHolding } = await supabase.from('holdings')
    .select('*').eq('client_id', clientId).eq('isin', isin).single();
  const oldQty = currentHolding?.quantity ?? 0;
  const oldAvg = currentHolding?.average_cost ?? 0;
  const oldInvested = currentHolding?.total_invested ?? 0;
  const oldRealizedPl = currentHolding?.realized_pl ?? 0;

  let newQty, newAvg, newInvested, newRealizedPl;
  if (side === 'BUY') {
    newQty = oldQty + raw.quantity;
    newAvg = newQty > 0 ? (oldQty * oldAvg + fees.net_value) / newQty : 0;
    newInvested = oldInvested + fees.net_value;
    newRealizedPl = oldRealizedPl;
  } else {
    newQty = Math.max(0, oldQty - raw.quantity);
    newAvg = oldAvg;
    newInvested = oldInvested;
    const costBasis = oldAvg > 0 ? oldAvg : (Number(raw.price) || 0);
    newRealizedPl = oldRealizedPl + (fees.net_value - costBasis * raw.quantity);
  }

  await supabase.from('holdings').upsert({
    client_id: clientId, isin, quantity: newQty,
    average_cost: Math.round(newAvg * 100) / 100,
    total_invested: Math.round(newInvested * 100) / 100,
    realized_pl: Math.round(newRealizedPl * 100) / 100,
    as_of_date: raw.trade_date,
  }, { onConflict: 'client_id,isin' });

  // Update cash ledger
  const { data: lastLedger } = await supabase.from('cash_ledger')
    .select('running_balance').eq('client_id', clientId)
    .order('id', { ascending: false }).limit(1).single();
  const prevBalance = lastLedger?.running_balance ?? 0;
  const cashAmount = side === 'BUY' ? -fees.net_value : fees.net_value;
  const newBalance = Math.round((prevBalance + cashAmount) * 100) / 100;

  await supabase.from('cash_ledger').insert({
    client_id: clientId, transaction_date: raw.trade_date, value_date: settlementDate,
    amount: Math.round(cashAmount * 100) / 100, running_balance: newBalance,
    type: side === 'BUY' ? 'BUY_TRADE' : 'SELL_TRADE',
    reference: raw.exec_id,
    narration: `${side} ${raw.quantity} ${raw.security_code || isin} @ ${raw.price}`,
  });

  await supabase.from('raw_trades').update({ processed: true }).eq('id', raw.id);
  return 'ok';
}

async function processBatch(feeSchedule) {
  const { data: rawTrades, error: fetchErr } = await supabase
    .from('raw_trades')
    .select('*')
    .eq('processed', false)
    .in('status', ['FILL', 'PF'])
    .gt('quantity', 0)
    .order('id', { ascending: true })
    .limit(BATCH_SIZE);

  if (fetchErr) throw new Error(`Fetch: ${fetchErr.message}`);
  if (!rawTrades || rawTrades.length === 0) return { processed: 0, failed: 0, done: true };

  const execIds = rawTrades.map(t => t.exec_id).filter(Boolean);
  const { data: existingExecs } = await supabase.from('trade_executions').select('exec_id').in('exec_id', execIds);
  const existingSet = new Set((existingExecs || []).map(e => e.exec_id));

  let processed = 0, failed = 0;

  // Process in chunks of CONCURRENCY
  for (let i = 0; i < rawTrades.length; i += CONCURRENCY) {
    const chunk = rawTrades.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map(raw => processSingleTrade(raw, feeSchedule, existingSet))
    );
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value === 'ok') processed++;
      else if (r.status === 'rejected') {
        failed++;
        console.error(`  Error: ${r.reason?.message || r.reason}`);
      }
    }
  }

  return { processed, failed, done: rawTrades.length < BATCH_SIZE };
}

async function main() {
  console.log('Loading fee schedule...');
  const feeSchedule = await loadFeeSchedule();
  console.log(`Fee schedule: ${feeSchedule.length} active entries`);
  console.log(`Batch size: ${BATCH_SIZE}, Concurrency: ${CONCURRENCY}`);

  let totalProcessed = 0, totalFailed = 0, batch = 0;
  const startTime = Date.now();

  while (true) {
    batch++;
    const result = await processBatch(feeSchedule);
    totalProcessed += result.processed;
    totalFailed += result.failed;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const rate = (totalProcessed / (elapsed / 60)).toFixed(0);
    console.log(`Batch ${batch}: +${result.processed}/${result.failed} | Total: ${totalProcessed} ok, ${totalFailed} fail | ${elapsed}s | ~${rate}/min`);

    if (result.done) {
      console.log(`\nDone! ${totalProcessed} processed, ${totalFailed} failed in ${elapsed}s`);
      break;
    }
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
