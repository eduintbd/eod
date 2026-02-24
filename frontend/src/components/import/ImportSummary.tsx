import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

interface SummaryData {
  dse_buy_count: number;
  dse_buy_value: number;
  dse_buy_qty: number;
  dse_sell_count: number;
  dse_sell_value: number;
  dse_sell_qty: number;
  cse_buy_count: number;
  cse_buy_value: number;
  cse_buy_qty: number;
  cse_sell_count: number;
  cse_sell_value: number;
  cse_sell_qty: number;
  deposit_count: number;
  deposit_total: number;
  withdrawal_count: number;
  withdrawal_total: number;
  opening_balance_count: number;
  opening_balance_total: number;
  total_clients: number;
  total_holdings: number;
  total_securities: number;
  trades_processed: number;
  trades_unprocessed: number;
}

function bdt(value: number): string {
  return new Intl.NumberFormat('en-BD', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(value));
}

export function ImportSummary() {
  const [data, setData] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    const { data: result, error: err } = await supabase.rpc('get_import_summary');
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    setData(result as SummaryData);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  if (loading) return <p className="text-sm text-muted-foreground">Loading summary...</p>;

  if (error) {
    return (
      <div className="bg-card rounded-lg border border-border p-4">
        <p className="text-sm text-destructive">
          Failed to load summary: {error}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Make sure the <code>get_import_summary()</code> function is created in the database.
        </p>
      </div>
    );
  }

  if (!data) return null;

  const dseTurnover = data.dse_buy_value + data.dse_sell_value;
  const cseTurnover = data.cse_buy_value + data.cse_sell_value;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Data Summary</h2>
        <button
          onClick={load}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Refresh
        </button>
      </div>

      {/* Trade Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* DSE */}
        <div className="bg-card rounded-lg border border-border p-4">
          <h3 className="text-sm font-medium text-muted-foreground mb-3">DSE Trades</h3>
          <div className="space-y-2">
            <div className="flex justify-between items-baseline">
              <span className="text-xs text-muted-foreground">Buy</span>
              <div className="text-right">
                <span className="text-lg font-semibold text-success">BDT {bdt(data.dse_buy_value)}</span>
                <span className="text-xs text-muted-foreground ml-2">
                  ({data.dse_buy_count.toLocaleString()} trades, {data.dse_buy_qty.toLocaleString()} qty)
                </span>
              </div>
            </div>
            <div className="flex justify-between items-baseline">
              <span className="text-xs text-muted-foreground">Sell</span>
              <div className="text-right">
                <span className="text-lg font-semibold text-destructive">BDT {bdt(data.dse_sell_value)}</span>
                <span className="text-xs text-muted-foreground ml-2">
                  ({data.dse_sell_count.toLocaleString()} trades, {data.dse_sell_qty.toLocaleString()} qty)
                </span>
              </div>
            </div>
            <div className="border-t border-border pt-2 flex justify-between items-baseline">
              <span className="text-xs font-medium">Turnover</span>
              <span className="font-semibold">BDT {bdt(dseTurnover)}</span>
            </div>
          </div>
        </div>

        {/* CSE */}
        <div className="bg-card rounded-lg border border-border p-4">
          <h3 className="text-sm font-medium text-muted-foreground mb-3">CSE Trades</h3>
          <div className="space-y-2">
            <div className="flex justify-between items-baseline">
              <span className="text-xs text-muted-foreground">Buy</span>
              <div className="text-right">
                <span className="text-lg font-semibold text-success">BDT {bdt(data.cse_buy_value)}</span>
                <span className="text-xs text-muted-foreground ml-2">
                  ({data.cse_buy_count.toLocaleString()} trades, {data.cse_buy_qty.toLocaleString()} qty)
                </span>
              </div>
            </div>
            <div className="flex justify-between items-baseline">
              <span className="text-xs text-muted-foreground">Sell</span>
              <div className="text-right">
                <span className="text-lg font-semibold text-destructive">BDT {bdt(data.cse_sell_value)}</span>
                <span className="text-xs text-muted-foreground ml-2">
                  ({data.cse_sell_count.toLocaleString()} trades, {data.cse_sell_qty.toLocaleString()} qty)
                </span>
              </div>
            </div>
            <div className="border-t border-border pt-2 flex justify-between items-baseline">
              <span className="text-xs font-medium">Turnover</span>
              <span className="font-semibold">BDT {bdt(cseTurnover)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Cash + Processing Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-card rounded-lg border border-border p-3 text-center">
          <p className="text-lg font-semibold text-success">BDT {bdt(data.deposit_total)}</p>
          <p className="text-xs text-muted-foreground">Deposits ({data.deposit_count.toLocaleString()})</p>
        </div>
        <div className="bg-card rounded-lg border border-border p-3 text-center">
          <p className="text-lg font-semibold text-destructive">BDT {bdt(data.withdrawal_total)}</p>
          <p className="text-xs text-muted-foreground">Withdrawals ({data.withdrawal_count.toLocaleString()})</p>
        </div>
        <div className="bg-card rounded-lg border border-border p-3 text-center">
          <p className="text-lg font-semibold">BDT {bdt(data.opening_balance_total)}</p>
          <p className="text-xs text-muted-foreground">Opening Bal ({data.opening_balance_count.toLocaleString()})</p>
        </div>
        <div className="bg-card rounded-lg border border-border p-3 text-center">
          <p className="text-lg font-semibold">{data.trades_processed.toLocaleString()}</p>
          <p className="text-xs text-muted-foreground">Trades Processed</p>
        </div>
      </div>

      {/* Bottom row stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-card rounded-lg border border-border p-3 text-center">
          <p className="text-lg font-semibold">{data.total_clients.toLocaleString()}</p>
          <p className="text-xs text-muted-foreground">Clients</p>
        </div>
        <div className="bg-card rounded-lg border border-border p-3 text-center">
          <p className="text-lg font-semibold">{data.total_securities.toLocaleString()}</p>
          <p className="text-xs text-muted-foreground">Securities</p>
        </div>
        <div className="bg-card rounded-lg border border-border p-3 text-center">
          <p className="text-lg font-semibold">{data.total_holdings.toLocaleString()}</p>
          <p className="text-xs text-muted-foreground">Holdings</p>
        </div>
        {data.trades_unprocessed > 0 && (
          <div className="bg-warning/10 rounded-lg border border-warning/30 p-3 text-center">
            <p className="text-lg font-semibold text-warning">{data.trades_unprocessed.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">Unprocessed Trades</p>
          </div>
        )}
      </div>
    </div>
  );
}
