import { corsHeaders } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/supabase-client.ts';
import { calculateFees, loadFeeSchedule } from '../_shared/fee-calculator.ts';
import { computeSettlementDate } from '../_shared/settlement.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = getServiceClient();
    const body = await req.json().catch(() => ({}));
    const importAuditId = body.import_audit_id;

    // Load fee schedule
    const feeSchedule = await loadFeeSchedule(supabase);

    // Step 1: Fetch unprocessed raw trades that are fills
    let query = supabase
      .from('raw_trades')
      .select('*')
      .eq('processed', false)
      .in('status', ['FILL', 'PF'])
      .gt('quantity', 0)
      .order('id', { ascending: true })
      .limit(200);

    if (importAuditId) {
      query = query.eq('import_audit_id', importAuditId);
    }

    const { data: rawTrades, error: fetchErr } = await query;
    if (fetchErr) throw new Error(`Fetch raw_trades: ${fetchErr.message}`);
    if (!rawTrades || rawTrades.length === 0) {
      return new Response(
        JSON.stringify({ processed_count: 0, failed_count: 0, message: 'No unprocessed trades found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Step 2: Get existing exec_ids to deduplicate
    const execIds = rawTrades
      .map((t: Record<string, unknown>) => t.exec_id as string)
      .filter((id: string) => id != null);

    const { data: existingExecs } = await supabase
      .from('trade_executions')
      .select('exec_id')
      .in('exec_id', execIds);

    const existingSet = new Set((existingExecs || []).map((e: Record<string, unknown>) => e.exec_id));

    let processedCount = 0;
    let failedCount = 0;
    const errors: Array<{ raw_trade_id: number; error: string }> = [];

    for (const raw of rawTrades) {
      try {
        // Skip if no exec_id or already processed
        if (!raw.exec_id || existingSet.has(raw.exec_id)) {
          await supabase
            .from('raw_trades')
            .update({ processed: true, error_message: raw.exec_id ? 'Duplicate exec_id' : 'Missing exec_id' })
            .eq('id', raw.id);
          continue;
        }

        // Step 3: Resolve client
        let clientId: string | null = null;
        if (raw.bo_id) {
          const { data: client } = await supabase
            .from('clients')
            .select('client_id')
            .eq('bo_id', raw.bo_id)
            .single();
          clientId = client?.client_id ?? null;
        }
        if (!clientId && raw.client_code) {
          const { data: client } = await supabase
            .from('clients')
            .select('client_id')
            .eq('client_code', raw.client_code)
            .single();
          clientId = client?.client_id ?? null;
        }

        // Create placeholder client if not found
        if (!clientId) {
          const { data: newClient, error: createErr } = await supabase
            .from('clients')
            .insert({
              bo_id: raw.bo_id || null,
              client_code: raw.client_code || `UNKNOWN-${raw.bo_id || raw.id}`,
              name: `Placeholder - ${raw.bo_id || raw.client_code}`,
              status: 'pending_review',
            })
            .select('client_id')
            .single();

          if (createErr) {
            // May already exist from concurrent insert, try lookup again
            const { data: retry } = await supabase
              .from('clients')
              .select('client_id')
              .or(`bo_id.eq.${raw.bo_id},client_code.eq.${raw.client_code}`)
              .single();
            clientId = retry?.client_id ?? null;
          } else {
            clientId = newClient?.client_id ?? null;
          }
        }

        if (!clientId) {
          throw new Error(`Cannot resolve client for bo_id=${raw.bo_id}, client_code=${raw.client_code}`);
        }

        // Step 3b: Income/KYC gate — block margin trades for ineligible clients
        const { data: clientInfo } = await supabase
          .from('clients')
          .select('account_type, income_status, kyc_completed')
          .eq('client_id', clientId)
          .single();

        if (clientInfo?.account_type === 'Margin') {
          const blockedStatuses = ['student', 'homemaker', 'retired'];
          if (clientInfo.income_status && blockedStatuses.includes(clientInfo.income_status.toLowerCase())) {
            throw new Error(`Margin trade rejected: client income_status="${clientInfo.income_status}" is not eligible for margin trading (BSEC Section 5)`);
          }
          if (clientInfo.kyc_completed === false) {
            throw new Error('Margin trade rejected: client KYC is not completed');
          }
        }

        // Step 4: Resolve security — prefer existing record to stay
        // consistent with holdings imported from admin balance
        let isin: string | null = null;

        // Priority 1: look up by security_code (most reliable match)
        if (raw.security_code) {
          const { data: byCode } = await supabase
            .from('securities')
            .select('isin')
            .eq('security_code', raw.security_code)
            .single();
          if (byCode) {
            isin = byCode.isin;
          }
        }

        // Priority 2: look up by raw ISIN
        if (!isin && raw.isin) {
          const { data: byIsin } = await supabase
            .from('securities')
            .select('isin')
            .eq('isin', raw.isin)
            .single();
          if (byIsin) {
            isin = byIsin.isin;
          }
        }

        // Priority 3: create new security if not found at all
        if (!isin) {
          isin = raw.isin || `PLACEHOLDER-${raw.security_code || raw.id}`;
          const code = raw.security_code || isin;
          const { error: secErr } = await supabase.from('securities').insert({
            isin,
            security_code: code,
            company_name: code,
            asset_class: raw.asset_class || 'EQ',
            category: raw.category,
            board: raw.board,
            status: 'active',
          });
          // If insert fails (duplicate security_code), try lookup again
          if (secErr) {
            const { data: retry } = await supabase
              .from('securities')
              .select('isin')
              .eq('security_code', code)
              .single();
            isin = retry?.isin ?? isin;
          }
        }

        // Step 5: Compute fees
        const side = raw.side === 'B' ? 'BUY' : 'SELL';
        const tradeValue = Number(raw.value) || 0;
        const fees = calculateFees(tradeValue, side as 'BUY' | 'SELL', feeSchedule);

        // Step 6: Compute settlement date
        const settlementDate = raw.trade_date
          ? computeSettlementDate(raw.trade_date, raw.category, side as 'BUY' | 'SELL', raw.compulsory_spot)
          : null;

        // Step 7: Insert trade execution
        const { error: insertErr } = await supabase
          .from('trade_executions')
          .insert({
            exec_id: raw.exec_id,
            order_id: raw.order_id,
            client_id: clientId,
            isin,
            exchange: raw.source,
            side,
            quantity: raw.quantity,
            price: raw.price,
            value: tradeValue,
            trade_date: raw.trade_date,
            trade_time: raw.trade_time,
            settlement_date: settlementDate,
            session: raw.session,
            fill_type: raw.fill_type,
            category: raw.category,
            board: raw.board,
            commission: fees.commission,
            exchange_fee: fees.exchange_fee,
            cdbl_fee: fees.cdbl_fee,
            ait: fees.ait,
            net_value: fees.net_value,
          });

        if (insertErr) throw new Error(`Insert trade_execution: ${insertErr.message}`);

        // Add to dedup set
        existingSet.add(raw.exec_id);

        // Step 8: Update holdings
        const { data: currentHolding } = await supabase
          .from('holdings')
          .select('*')
          .eq('client_id', clientId)
          .eq('isin', isin)
          .single();

        const oldQty = currentHolding?.quantity ?? 0;
        const oldAvg = currentHolding?.average_cost ?? 0;
        const oldInvested = currentHolding?.total_invested ?? 0;
        const oldRealizedPl = currentHolding?.realized_pl ?? 0;

        let newQty: number;
        let newAvg: number;
        let newInvested: number;
        let newRealizedPl: number;

        if (side === 'BUY') {
          newQty = oldQty + raw.quantity;
          // new_avg = (old_qty * old_avg + buy_net_value) / (old_qty + buy_qty)
          newAvg = newQty > 0 ? (oldQty * oldAvg + fees.net_value) / newQty : 0;
          newInvested = oldInvested + fees.net_value;
          newRealizedPl = oldRealizedPl;
        } else {
          // SELL
          newQty = Math.max(0, oldQty - raw.quantity); // Prevent negative quantities
          newAvg = oldAvg; // Average cost does NOT change on sells
          newInvested = oldInvested;
          // Use trade price as fallback cost basis when no prior holdings exist
          const costBasis = oldAvg > 0 ? oldAvg : (Number(raw.price) || 0);
          // realized_pl += (sell_net_proceeds - cost_basis * sell_qty)
          newRealizedPl = oldRealizedPl + (fees.net_value - costBasis * raw.quantity);
        }

        await supabase
          .from('holdings')
          .upsert({
            client_id: clientId,
            isin,
            quantity: newQty,
            average_cost: Math.round(newAvg * 100) / 100,
            total_invested: Math.round(newInvested * 100) / 100,
            realized_pl: Math.round(newRealizedPl * 100) / 100,
            as_of_date: raw.trade_date,
          }, { onConflict: 'client_id,isin' });

        // Step 9: Update cash ledger
        const { data: lastLedger } = await supabase
          .from('cash_ledger')
          .select('running_balance')
          .eq('client_id', clientId)
          .order('id', { ascending: false })
          .limit(1)
          .single();

        const prevBalance = lastLedger?.running_balance ?? 0;
        const cashAmount = side === 'BUY' ? -fees.net_value : fees.net_value;
        const newBalance = Math.round((prevBalance + cashAmount) * 100) / 100;

        await supabase.from('cash_ledger').insert({
          client_id: clientId,
          transaction_date: raw.trade_date,
          value_date: settlementDate,
          amount: Math.round(cashAmount * 100) / 100,
          running_balance: newBalance,
          type: side === 'BUY' ? 'BUY_TRADE' : 'SELL_TRADE',
          reference: raw.exec_id,
          narration: `${side} ${raw.quantity} ${raw.security_code || isin} @ ${raw.price}`,
        });

        // Step 10: Mark as processed
        await supabase
          .from('raw_trades')
          .update({ processed: true })
          .eq('id', raw.id);

        processedCount++;
      } catch (err) {
        failedCount++;
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({ raw_trade_id: raw.id, error: msg });

        await supabase
          .from('raw_trades')
          .update({ processed: false, error_message: msg })
          .eq('id', raw.id);
      }
    }

    return new Response(
      JSON.stringify({
        processed_count: processedCount,
        failed_count: failedCount,
        total_raw: rawTrades.length,
        errors: errors.slice(0, 50),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
