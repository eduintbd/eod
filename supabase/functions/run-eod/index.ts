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
    const eodDate: string = body.eod_date;
    const force: boolean = body.force ?? false;
    const offset: number = body.offset ?? 0;

    if (!eodDate) {
      return new Response(
        JSON.stringify({ error: 'eod_date is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // =========================================================================
    // FIRST BATCH ONLY: Pre-flight validation + create/update eod_runs record
    // =========================================================================
    if (offset === 0) {
      // Run preflight checks
      const { data: preflight, error: preErr } = await supabase.rpc('get_eod_preflight', { p_date: eodDate });
      if (preErr) throw new Error(`Preflight failed: ${preErr.message}`);

      const pf = preflight as Record<string, unknown>;

      // Block if unprocessed trades exist (unless force)
      if (!force && (pf.unprocessed_trades as number) > 0) {
        return new Response(
          JSON.stringify({
            error: `${pf.unprocessed_trades} unprocessed trades for ${eodDate}. Process them first or use force=true.`,
            preflight: pf,
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Block if currently running (unless force)
      if (!force && pf.currently_running) {
        return new Response(
          JSON.stringify({ error: `EOD for ${eodDate} is already running.`, preflight: pf }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Block if already completed (unless force)
      if (!force && pf.already_run) {
        return new Response(
          JSON.stringify({ error: `EOD for ${eodDate} has already been completed. Use force=true to re-run.`, preflight: pf }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Upsert eod_runs record — RUNNING
      const { error: upsertErr } = await supabase
        .from('eod_runs')
        .upsert({
          eod_date: eodDate,
          status: 'RUNNING',
          started_at: new Date().toISOString(),
          completed_at: null,
          total_clients: pf.total_clients as number,
          trades_for_date: pf.trades_for_date as number,
          unprocessed_trades: pf.unprocessed_trades as number,
          deposits_for_date: pf.deposits_for_date as number,
          prices_available: pf.prices_available as boolean,
          snapshots_created: 0,
          margin_alerts_generated: 0,
          error_details: null,
        }, { onConflict: 'eod_date' });

      if (upsertErr) throw new Error(`Create eod_runs: ${upsertErr.message}`);
    }

    // =========================================================================
    // Load margin config
    // =========================================================================
    const config = await loadMarginConfig(supabase);

    // =========================================================================
    // Fetch batch of ALL active clients (not just Margin)
    // =========================================================================
    const { data: clients, error: clientErr } = await supabase
      .from('clients')
      .select('client_id, client_code, name, account_type')
      .eq('status', 'active')
      .order('client_id', { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1);

    if (clientErr) throw new Error(`Fetch clients: ${clientErr.message}`);

    if (!clients || clients.length === 0) {
      // No more clients — this is the final batch signal
      return new Response(
        JSON.stringify({
          eod_date: eodDate,
          clients_processed: 0,
          snapshots_created: 0,
          margin_alerts_generated: 0,
          done: true,
          offset,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let snapshotsCreated = 0;
    let alertsGenerated = 0;
    let clientsProcessed = 0;
    const errors: Array<{ client_id: string; error: string }> = [];

    // =========================================================================
    // Process each client in the batch
    // =========================================================================
    for (const client of clients) {
      try {
        // --- Holdings with qty > 0 ---
        const { data: holdings, error: holdErr } = await supabase
          .from('holdings')
          .select('isin, quantity, average_cost, security:securities(is_marginable)')
          .eq('client_id', client.client_id)
          .gt('quantity', 0);

        if (holdErr) throw new Error(`Fetch holdings: ${holdErr.message}`);

        const isins = (holdings || []).map((h: Record<string, unknown>) => h.isin as string);

        // --- Prices (exact date, fallback to most recent) ---
        const priceMap: Record<string, number> = {};
        if (isins.length > 0) {
          const { data: prices } = await supabase
            .from('daily_prices')
            .select('isin, close_price')
            .in('isin', isins)
            .eq('date', eodDate);

          if (prices) {
            for (const p of prices) {
              priceMap[p.isin as string] = Number(p.close_price);
            }
          }

          const missingIsins = isins.filter((i: string) => !(i in priceMap));
          for (const isin of missingIsins) {
            const { data: fallback } = await supabase
              .from('daily_prices')
              .select('close_price')
              .eq('isin', isin)
              .lt('date', eodDate)
              .order('date', { ascending: false })
              .limit(1)
              .single();

            if (fallback) {
              priceMap[isin] = Number(fallback.close_price);
            }
          }
        }

        // --- Portfolio values ---
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

        // --- Cash balance (latest running_balance up to eod_date) ---
        const { data: lastLedger } = await supabase
          .from('cash_ledger')
          .select('running_balance')
          .eq('client_id', client.client_id)
          .lte('transaction_date', eodDate)
          .order('id', { ascending: false })
          .limit(1)
          .single();

        const cashBalance = Number(lastLedger?.running_balance ?? 0);
        const loanBalance = cashBalance < 0 ? Math.abs(cashBalance) : 0;
        const totalEquity = totalPortfolioValue - loanBalance;
        const unrealizedPl = totalPortfolioValue - totalCostBasis;
        const marginUtilPct = totalPortfolioValue > 0 ? loanBalance / totalPortfolioValue : 0;

        // --- UPSERT daily_snapshot ---
        const { error: snapErr } = await supabase
          .from('daily_snapshots')
          .upsert({
            client_id: client.client_id,
            snapshot_date: eodDate,
            total_portfolio_value: round(totalPortfolioValue),
            cash_balance: round(cashBalance),
            loan_balance: round(loanBalance),
            net_equity: round(totalEquity),
            margin_utilization_pct: round4(marginUtilPct),
            unrealized_pl: round(unrealizedPl),
          }, { onConflict: 'client_id,snapshot_date' });

        if (!snapErr) snapshotsCreated++;
        clientsProcessed++;

        // =================================================================
        // MARGIN LOGIC — only for Margin account clients
        // =================================================================
        if (client.account_type === 'Margin') {
          const marginableEquity = marginablePortfolioValue - loanBalance;
          const equityRatio = marginablePortfolioValue > 0
            ? marginableEquity / marginablePortfolioValue
            : 1;

          const { ratio: appliedRatio } = determineAppliedRatio(marginablePortfolioValue, config);
          const status = determineMarginStatus(equityRatio, config.normal_threshold, config.force_sell_threshold);

          // Fetch existing margin_account for status change detection
          const { data: existingMargin } = await supabase
            .from('margin_accounts')
            .select('maintenance_status, margin_call_count, margin_call_deadline')
            .eq('client_id', client.client_id)
            .single();

          const prevStatus = (existingMargin?.maintenance_status as MarginStatus | null) ?? null;
          const prevCallCount = existingMargin?.margin_call_count ?? 0;

          // Deadline enforcement: auto-escalate MARGIN_CALL → FORCE_SELL
          let effectiveStatus = status;
          let deadlineBreached = false;
          if (
            status === 'MARGIN_CALL' &&
            existingMargin?.margin_call_deadline &&
            existingMargin.margin_call_deadline < eodDate
          ) {
            effectiveStatus = 'FORCE_SELL';
            deadlineBreached = true;
          }

          // Upsert margin_accounts
          const marginUpsert: Record<string, unknown> = {
            client_id: client.client_id,
            loan_balance: round(loanBalance),
            margin_ratio: round4(equityRatio),
            portfolio_value: round(totalPortfolioValue),
            marginable_portfolio_value: round(marginablePortfolioValue),
            total_portfolio_value: round(totalPortfolioValue),
            client_equity: round(totalEquity),
            maintenance_status: effectiveStatus,
            applied_ratio: appliedRatio,
          };

          if (effectiveStatus === 'MARGIN_CALL' || effectiveStatus === 'FORCE_SELL') {
            if (prevStatus !== effectiveStatus) {
              marginUpsert.last_margin_call_date = eodDate;
              marginUpsert.margin_call_count = prevCallCount + 1;
              if (effectiveStatus === 'MARGIN_CALL') {
                marginUpsert.margin_call_deadline = addBusinessDays(
                  new Date(eodDate + 'T00:00:00'),
                  config.margin_call_deadline_days,
                );
              } else {
                marginUpsert.margin_call_deadline = null;
              }
            }
          } else if (effectiveStatus === 'NORMAL') {
            marginUpsert.margin_call_count = 0;
            marginUpsert.margin_call_deadline = null;
          }

          await supabase
            .from('margin_accounts')
            .upsert(marginUpsert, { onConflict: 'client_id' });

          // Generate alert on status change
          if (prevStatus !== effectiveStatus && (effectiveStatus === 'MARGIN_CALL' || effectiveStatus === 'FORCE_SELL')) {
            const alertType = effectiveStatus === 'FORCE_SELL' ? 'FORCE_SELL_TRIGGERED' : 'MARGIN_CALL';
            const deadlineDate = effectiveStatus === 'MARGIN_CALL'
              ? addBusinessDays(new Date(eodDate + 'T00:00:00'), config.margin_call_deadline_days)
              : null;

            const { error: alertErr } = await supabase
              .from('margin_alerts')
              .insert({
                client_id: client.client_id,
                alert_date: eodDate,
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

          // DEADLINE_BREACH alert
          if (deadlineBreached) {
            const { data: existingDeadlineAlert } = await supabase
              .from('margin_alerts')
              .select('id')
              .eq('client_id', client.client_id)
              .eq('alert_date', eodDate)
              .eq('alert_type', 'DEADLINE_BREACH')
              .limit(1)
              .maybeSingle();

            if (!existingDeadlineAlert) {
              const { error: dbErr } = await supabase
                .from('margin_alerts')
                .insert({
                  client_id: client.client_id,
                  alert_date: eodDate,
                  alert_type: 'DEADLINE_BREACH',
                  details: {
                    original_deadline: existingMargin.margin_call_deadline,
                    equity_ratio: round4(equityRatio),
                    loan_balance: round(loanBalance),
                    escalated_to: 'FORCE_SELL',
                  },
                });
              if (!dbErr) alertsGenerated++;
            }
          }

          // Single client exposure limit
          if (loanBalance > 0 && config.core_capital_net_worth > 0) {
            const clientLimit = Math.min(
              config.core_capital_net_worth * config.single_client_limit_pct,
              config.single_client_limit_max,
            );
            if (loanBalance > clientLimit) {
              const { data: existingExposureAlert } = await supabase
                .from('margin_alerts')
                .select('id')
                .eq('client_id', client.client_id)
                .eq('alert_date', eodDate)
                .eq('alert_type', 'EXPOSURE_BREACH')
                .limit(1)
                .maybeSingle();

              if (!existingExposureAlert) {
                const { error: expErr } = await supabase
                  .from('margin_alerts')
                  .insert({
                    client_id: client.client_id,
                    alert_date: eodDate,
                    alert_type: 'EXPOSURE_BREACH',
                    details: {
                      breach_type: 'SINGLE_CLIENT',
                      loan_balance: round(loanBalance),
                      client_limit: round(clientLimit),
                      core_capital: round(config.core_capital_net_worth),
                      limit_pct: config.single_client_limit_pct,
                    },
                  });
                if (!expErr) alertsGenerated++;
              }
            }
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({ client_id: client.client_id, error: msg });
      }
    }

    const isFinalBatch = clients.length < BATCH_SIZE;

    // =========================================================================
    // FINAL BATCH: concentration checks, amount_payable, advance import_state, finalize
    // =========================================================================
    if (isFinalBatch) {
      // --- Concentration checks (Section 18) ---
      try {
        const { data: allMarginAccounts } = await supabase
          .from('margin_accounts')
          .select('client_id, loan_balance, marginable_portfolio_value')
          .gt('loan_balance', 0);

        if (allMarginAccounts && allMarginAccounts.length > 0) {
          const totalOutstandingMargin = allMarginAccounts.reduce(
            (sum: number, m: Record<string, unknown>) => sum + Number(m.loan_balance), 0);

          if (totalOutstandingMargin > 0) {
            const marginClientIds = allMarginAccounts.map((m: Record<string, unknown>) => m.client_id as string);

            const { data: allHoldings } = await supabase
              .from('holdings')
              .select('client_id, isin, quantity, average_cost')
              .in('client_id', marginClientIds)
              .gt('quantity', 0);

            if (allHoldings && allHoldings.length > 0) {
              const clientPortfolioMap: Record<string, number> = {};
              const isinLoanAttribution: Record<string, number> = {};

              for (const h of allHoldings) {
                const cId = h.client_id as string;
                const holdingValue = Number(h.quantity) * Number(h.average_cost);
                clientPortfolioMap[cId] = (clientPortfolioMap[cId] ?? 0) + holdingValue;
              }

              for (const h of allHoldings) {
                const cId = h.client_id as string;
                const holdingValue = Number(h.quantity) * Number(h.average_cost);
                const clientPortfolio = clientPortfolioMap[cId] ?? 0;
                if (clientPortfolio <= 0) continue;
                const marginAcct = allMarginAccounts.find((m: Record<string, unknown>) => m.client_id === cId);
                const clientLoan = Number(marginAcct?.loan_balance ?? 0);
                const attribution = (holdingValue / clientPortfolio) * clientLoan;
                const isinKey = h.isin as string;
                isinLoanAttribution[isinKey] = (isinLoanAttribution[isinKey] ?? 0) + attribution;
              }

              const concentrationLimit = config.single_security_limit_pct * totalOutstandingMargin;

              for (const [isin, attributedLoan] of Object.entries(isinLoanAttribution)) {
                if (attributedLoan > concentrationLimit) {
                  const affectedClients = allHoldings
                    .filter((h: Record<string, unknown>) => h.isin === isin)
                    .map((h: Record<string, unknown>) => h.client_id as string);
                  const uniqueClients = [...new Set(affectedClients)];

                  for (const affectedClientId of uniqueClients) {
                    const { data: existing } = await supabase
                      .from('margin_alerts')
                      .select('id')
                      .eq('client_id', affectedClientId)
                      .eq('alert_date', eodDate)
                      .eq('alert_type', 'CONCENTRATION_BREACH')
                      .limit(1)
                      .maybeSingle();

                    if (!existing) {
                      const { error: concErr } = await supabase
                        .from('margin_alerts')
                        .insert({
                          client_id: affectedClientId,
                          alert_date: eodDate,
                          alert_type: 'CONCENTRATION_BREACH',
                          details: {
                            isin,
                            attributed_loan: round(attributedLoan),
                            concentration_limit: round(concentrationLimit),
                            total_outstanding_margin: round(totalOutstandingMargin),
                            limit_pct: config.single_security_limit_pct,
                          },
                        });
                      if (!concErr) alertsGenerated++;
                    }
                  }
                }
              }
            }
          }
        }
      } catch (concError) {
        const msg = concError instanceof Error ? concError.message : String(concError);
        errors.push({ client_id: 'CONCENTRATION_CHECK', error: msg });
      }

      // --- Compute amount_payable ---
      try {
        await supabase.rpc('compute_amount_payable');
      } catch (_) {
        // Non-fatal
      }

      // --- Advance import_state.last_processed_date ---
      const { error: stateErr } = await supabase
        .from('import_state')
        .update({ last_processed_date: eodDate })
        .eq('id', 1);

      if (stateErr) {
        errors.push({ client_id: 'IMPORT_STATE', error: stateErr.message });
      }

      // --- Aggregate summary stats for eod_runs ---
      const { data: summaryData } = await supabase
        .from('daily_snapshots')
        .select('total_portfolio_value, cash_balance, loan_balance')
        .eq('snapshot_date', eodDate);

      let totalPV = 0, totalCash = 0, totalLoan = 0, negBalCount = 0;
      if (summaryData) {
        for (const s of summaryData) {
          totalPV += Number(s.total_portfolio_value);
          totalCash += Number(s.cash_balance);
          totalLoan += Number(s.loan_balance);
          if (Number(s.cash_balance) < 0) negBalCount++;
        }
      }

      const { count: totalSnaps } = await supabase
        .from('daily_snapshots')
        .select('*', { count: 'exact', head: true })
        .eq('snapshot_date', eodDate);

      const { count: totalAlerts } = await supabase
        .from('margin_alerts')
        .select('*', { count: 'exact', head: true })
        .eq('alert_date', eodDate);

      // --- Finalize eod_runs to COMPLETED ---
      await supabase
        .from('eod_runs')
        .update({
          status: errors.length > 0 ? 'COMPLETED' : 'COMPLETED',
          completed_at: new Date().toISOString(),
          snapshots_created: totalSnaps ?? 0,
          margin_alerts_generated: totalAlerts ?? 0,
          clients_with_negative_balance: negBalCount,
          total_portfolio_value: round(totalPV),
          total_cash_balance: round(totalCash),
          total_loan_balance: round(totalLoan),
          error_details: errors.length > 0 ? errors : null,
        })
        .eq('eod_date', eodDate);
    }

    return new Response(
      JSON.stringify({
        eod_date: eodDate,
        clients_processed: clientsProcessed,
        snapshots_created: snapshotsCreated,
        margin_alerts_generated: alertsGenerated,
        batch_size: clients.length,
        offset,
        done: isFinalBatch,
        errors: errors.slice(0, 50),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    // On top-level error, mark eod_runs as FAILED
    try {
      const supabase = getServiceClient();
      const body = await req.clone().json().catch(() => ({}));
      if (body.eod_date) {
        await supabase
          .from('eod_runs')
          .update({
            status: 'FAILED',
            completed_at: new Date().toISOString(),
            error_details: { error: err instanceof Error ? err.message : String(err) },
          })
          .eq('eod_date', body.eod_date);
      }
    } catch (_) {
      // Ignore cleanup errors
    }

    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
