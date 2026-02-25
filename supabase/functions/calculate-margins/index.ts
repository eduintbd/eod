import { corsHeaders } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/supabase-client.ts';
import { determineMarginStatus, determineAppliedRatio, type MarginStatus } from '../_shared/margin-rules.ts';
import { loadMarginConfig } from '../_shared/margin-config.ts';
import { addBusinessDays } from '../_shared/settlement.ts';

const BATCH_SIZE = 200;

const round = (v: number) => Math.round(v * 100) / 100;
const round4 = (v: number) => Math.round(v * 10000) / 10000;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = getServiceClient();
    const body = await req.json().catch(() => ({}));
    const inputDate: string | undefined = body.snapshot_date;
    const singleClientId: string | undefined = body.client_id;
    const offset: number = body.offset ?? 0;

    // Step 1: Load margin config from DB
    const config = await loadMarginConfig(supabase);

    // Step 2: Determine snapshot_date
    let snapshotDate: string;
    if (inputDate) {
      snapshotDate = inputDate;
    } else {
      const { data: maxRow, error: maxErr } = await supabase
        .from('daily_prices')
        .select('date')
        .order('date', { ascending: false })
        .limit(1)
        .single();
      if (maxErr || !maxRow) throw new Error(`Cannot determine snapshot date: ${maxErr?.message}`);
      snapshotDate = maxRow.date;
    }

    // Step 3: Fetch batch of margin clients
    let clientQuery = supabase
      .from('clients')
      .select('client_id, client_code, name')
      .eq('account_type', 'Margin')
      .order('client_id', { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1);

    if (singleClientId) {
      clientQuery = supabase
        .from('clients')
        .select('client_id, client_code, name')
        .eq('client_id', singleClientId)
        .limit(1);
    }

    const { data: clients, error: clientErr } = await clientQuery;
    if (clientErr) throw new Error(`Fetch clients: ${clientErr.message}`);
    if (!clients || clients.length === 0) {
      return new Response(
        JSON.stringify({
          snapshot_date: snapshotDate,
          clients_processed: 0,
          status_counts: { NORMAL: 0, MARGIN_CALL: 0, FORCE_SELL: 0 },
          alerts_generated: 0,
          snapshots_created: 0,
          done: true,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const statusCounts: Record<MarginStatus, number> = { NORMAL: 0, MARGIN_CALL: 0, FORCE_SELL: 0 };
    let alertsGenerated = 0;
    let snapshotsCreated = 0;
    let clientsProcessed = 0;
    const errors: Array<{ client_id: string; error: string }> = [];

    for (const client of clients) {
      try {
        // Step 4a: Get holdings with quantity > 0, joined with security marginability
        const { data: holdings, error: holdErr } = await supabase
          .from('holdings')
          .select('isin, quantity, average_cost, security:securities(is_marginable)')
          .eq('client_id', client.client_id)
          .gt('quantity', 0);

        if (holdErr) throw new Error(`Fetch holdings: ${holdErr.message}`);

        const isins = (holdings || []).map((h: Record<string, unknown>) => h.isin as string);

        // Step 4b: Get prices for those ISINs on snapshot_date
        const priceMap: Record<string, number> = {};
        if (isins.length > 0) {
          // Try exact date first
          const { data: prices } = await supabase
            .from('daily_prices')
            .select('isin, close_price')
            .in('isin', isins)
            .eq('date', snapshotDate);

          if (prices) {
            for (const p of prices) {
              priceMap[p.isin as string] = Number(p.close_price);
            }
          }

          // Fallback: most recent price before snapshot_date
          const missingIsins = isins.filter((i: string) => !(i in priceMap));
          for (const isin of missingIsins) {
            const { data: fallback } = await supabase
              .from('daily_prices')
              .select('close_price')
              .eq('isin', isin)
              .lt('date', snapshotDate)
              .order('date', { ascending: false })
              .limit(1)
              .single();

            if (fallback) {
              priceMap[isin] = Number(fallback.close_price);
            }
          }
        }

        // Step 4c: Calculate BOTH total and marginable portfolio values
        let totalPortfolioValue = 0;
        let marginablePortfolioValue = 0;
        let totalCostBasis = 0;
        for (const h of (holdings || [])) {
          const qty = Number(h.quantity);
          const avgCost = Number(h.average_cost);
          const price = priceMap[h.isin as string] ?? avgCost;
          const holdingValue = qty * price;

          totalPortfolioValue += holdingValue;
          totalCostBasis += qty * avgCost;

          // deno-lint-ignore no-explicit-any
          const sec = (h as any).security;
          if (sec?.is_marginable === true) {
            marginablePortfolioValue += holdingValue;
          }
        }

        // Step 4d: Cash balance — latest running_balance from cash_ledger
        const { data: lastLedger } = await supabase
          .from('cash_ledger')
          .select('running_balance')
          .eq('client_id', client.client_id)
          .order('id', { ascending: false })
          .limit(1)
          .single();

        const cashBalance = Number(lastLedger?.running_balance ?? 0);

        // Step 4e: Loan balance = ABS(cash_balance) if negative, else 0
        const loanBalance = cashBalance < 0 ? Math.abs(cashBalance) : 0;

        // Step 4f: Equity based on marginable portfolio (for compliance)
        const marginableEquity = marginablePortfolioValue - loanBalance;
        const equityRatio = marginablePortfolioValue > 0
          ? marginableEquity / marginablePortfolioValue
          : 1;

        // Total equity for display purposes
        const totalEquity = totalPortfolioValue - loanBalance;

        // Step 4g: Determine dynamic ratio based on portfolio size and market P/E
        const { ratio: appliedRatio } = determineAppliedRatio(marginablePortfolioValue, config);

        // Step 4h: Determine status using configurable thresholds
        const status = determineMarginStatus(equityRatio, config.normal_threshold, config.force_sell_threshold);
        statusCounts[status]++;

        // Step 5: Fetch existing margin_account to detect status changes
        const { data: existingMargin } = await supabase
          .from('margin_accounts')
          .select('maintenance_status, margin_call_count')
          .eq('client_id', client.client_id)
          .single();

        const prevStatus = (existingMargin?.maintenance_status as MarginStatus | null) ?? null;
        const prevCallCount = existingMargin?.margin_call_count ?? 0;

        // Build upsert payload with new BSEC fields
        const marginUpsert: Record<string, unknown> = {
          client_id: client.client_id,
          loan_balance: round(loanBalance),
          margin_ratio: round4(equityRatio),
          portfolio_value: round(totalPortfolioValue),  // backward compat
          marginable_portfolio_value: round(marginablePortfolioValue),
          total_portfolio_value: round(totalPortfolioValue),
          client_equity: round(totalEquity),
          maintenance_status: status,
          applied_ratio: appliedRatio,
        };

        // Status transition logic
        if (status === 'MARGIN_CALL' || status === 'FORCE_SELL') {
          if (prevStatus !== status) {
            marginUpsert.last_margin_call_date = snapshotDate;
            marginUpsert.margin_call_count = prevCallCount + 1;

            // Set 3-business-day deadline on MARGIN_CALL (Section 9(3))
            if (status === 'MARGIN_CALL') {
              marginUpsert.margin_call_deadline = addBusinessDays(
                new Date(snapshotDate + 'T00:00:00'),
                config.margin_call_deadline_days,
              );
            } else {
              // FORCE_SELL — no deadline, immediate action required
              marginUpsert.margin_call_deadline = null;
            }
          }
        } else if (status === 'NORMAL') {
          marginUpsert.margin_call_count = 0;
          marginUpsert.margin_call_deadline = null;
        }

        await supabase
          .from('margin_accounts')
          .upsert(marginUpsert, { onConflict: 'client_id' });

        // Step 6: Generate alert only on status change
        if (prevStatus !== status && (status === 'MARGIN_CALL' || status === 'FORCE_SELL')) {
          const alertType = status === 'FORCE_SELL' ? 'FORCE_SELL_TRIGGERED' : 'MARGIN_CALL';
          const deadlineDate = status === 'MARGIN_CALL'
            ? addBusinessDays(new Date(snapshotDate + 'T00:00:00'), config.margin_call_deadline_days)
            : null;

          const { error: alertErr } = await supabase
            .from('margin_alerts')
            .insert({
              client_id: client.client_id,
              alert_date: snapshotDate,
              alert_type: alertType,
              deadline_date: deadlineDate,
              details: {
                equity_ratio: round4(equityRatio),
                marginable_portfolio_value: round(marginablePortfolioValue),
                total_portfolio_value: round(totalPortfolioValue),
                loan_balance: round(loanBalance),
                client_equity: round(totalEquity),
                applied_ratio: appliedRatio,
                margin_call_count: (marginUpsert.margin_call_count as number) ?? prevCallCount,
                deadline_date: deadlineDate,
              },
            });

          if (!alertErr) alertsGenerated++;
        }

        // Step 7: Upsert daily_snapshot
        const unrealizedPl = totalPortfolioValue - totalCostBasis;
        const marginUtilPct = totalPortfolioValue > 0 ? loanBalance / totalPortfolioValue : 0;

        const { error: snapErr } = await supabase
          .from('daily_snapshots')
          .upsert({
            client_id: client.client_id,
            snapshot_date: snapshotDate,
            total_portfolio_value: round(totalPortfolioValue),
            cash_balance: round(cashBalance),
            loan_balance: round(loanBalance),
            net_equity: round(totalEquity),
            margin_utilization_pct: round4(marginUtilPct),
            unrealized_pl: round(unrealizedPl),
          }, { onConflict: 'client_id,snapshot_date' });

        if (!snapErr) snapshotsCreated++;
        clientsProcessed++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({ client_id: client.client_id, error: msg });
      }
    }

    // Step 8: Return summary
    return new Response(
      JSON.stringify({
        snapshot_date: snapshotDate,
        clients_processed: clientsProcessed,
        status_counts: statusCounts,
        alerts_generated: alertsGenerated,
        snapshots_created: snapshotsCreated,
        batch_size: clients.length,
        offset,
        done: clients.length < BATCH_SIZE,
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
