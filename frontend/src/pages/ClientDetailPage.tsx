import { useEffect, useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatBDT, formatNumber, formatPct } from '@/lib/utils';
import { useLatestPrices } from '@/hooks/useMarketData';
import type { Client, Holding, CashLedgerEntry, TradeExecution, Security } from '@/lib/types';

export function ClientDetailPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const [client, setClient] = useState<Client | null>(null);
  const [holdings, setHoldings] = useState<(Holding & { security?: Security })[]>([]);
  const [cashEntries, setCashEntries] = useState<CashLedgerEntry[]>([]);
  const [trades, setTrades] = useState<TradeExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'holdings' | 'cash' | 'trades'>('holdings');

  useEffect(() => {
    if (!clientId) return;

    async function load() {
      const [clientRes, holdingsRes, cashRes, tradesRes] = await Promise.all([
        supabase.from('clients').select('*').eq('client_id', clientId).single(),
        supabase
          .from('holdings')
          .select('*, security:securities(*)')
          .eq('client_id', clientId)
          .gt('quantity', 0)
          .order('isin'),
        supabase
          .from('cash_ledger')
          .select('*')
          .eq('client_id', clientId)
          .order('id', { ascending: false })
          .limit(100),
        supabase
          .from('trade_executions')
          .select('*')
          .eq('client_id', clientId)
          .order('trade_date', { ascending: false })
          .limit(100),
      ]);

      setClient(clientRes.data as Client | null);
      setHoldings((holdingsRes.data ?? []) as (Holding & { security?: Security })[]);
      setCashEntries((cashRes.data ?? []) as CashLedgerEntry[]);
      setTrades((tradesRes.data ?? []) as TradeExecution[]);
      setLoading(false);
    }
    load();
  }, [clientId]);

  // Extract security codes from holdings to fetch live prices
  const symbols = useMemo(
    () => holdings
      .map(h => h.security?.security_code)
      .filter((c): c is string => c != null),
    [holdings],
  );

  const { prices: livePrices, loading: pricesLoading } = useLatestPrices(symbols);

  if (loading) return <div className="text-muted-foreground">Loading...</div>;
  if (!client) return <div className="text-destructive">Client not found</div>;

  // Get the live market price for a holding, fallback to local last_close_price, then avg cost
  function getLivePrice(h: Holding & { security?: Security }): number {
    const code = h.security?.security_code;
    if (code && livePrices[code]) {
      return livePrices[code].close;
    }
    return h.security?.last_close_price ?? h.average_cost;
  }

  // Compute portfolio summary using live prices
  const totalCost = holdings.reduce((sum, h) => sum + h.quantity * h.average_cost, 0);
  const totalMarketValue = holdings.reduce((sum, h) => sum + h.quantity * getLivePrice(h), 0);
  const unrealizedPl = totalMarketValue - totalCost;
  const totalRealizedPl = holdings.reduce((sum, h) => sum + h.realized_pl, 0);
  const cashBalance = cashEntries.length > 0 ? cashEntries[0].running_balance : 0;
  const netEquity = totalMarketValue + cashBalance;

  const tabs = [
    { key: 'holdings' as const, label: `Holdings (${holdings.length})` },
    { key: 'cash' as const, label: 'Cash Ledger' },
    { key: 'trades' as const, label: 'Trade History' },
  ];

  return (
    <div>
      <Link to="/clients" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft size={16} /> Back to Clients
      </Link>

      <div className="flex items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">{client.name || 'Unknown'}</h1>
          <p className="text-sm text-muted-foreground">
            Code: {client.client_code} | BOID: {client.bo_id} | {client.account_type ?? 'Cash'}
          </p>
        </div>
        <span className={`ml-auto px-3 py-1 rounded text-xs font-medium ${
          client.status === 'active' ? 'bg-success/10 text-success' :
          client.status === 'pending_review' ? 'bg-warning/10 text-warning' :
          'bg-destructive/10 text-destructive'
        }`}>
          {client.status}
        </span>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        <div className="bg-card rounded-lg border border-border p-4">
          <p className="text-xs text-muted-foreground mb-1">Portfolio (Cost)</p>
          <p className="text-lg font-semibold">{formatBDT(totalCost)}</p>
        </div>
        <div className="bg-card rounded-lg border border-border p-4">
          <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
            Market Value
            {pricesLoading && <RefreshCw size={10} className="animate-spin" />}
          </p>
          <p className="text-lg font-semibold">{formatBDT(totalMarketValue)}</p>
        </div>
        <div className="bg-card rounded-lg border border-border p-4">
          <p className="text-xs text-muted-foreground mb-1">Unrealized P&L</p>
          <p className={`text-lg font-semibold ${unrealizedPl >= 0 ? 'text-success' : 'text-destructive'}`}>
            {formatBDT(unrealizedPl)}
          </p>
        </div>
        <div className="bg-card rounded-lg border border-border p-4">
          <p className="text-xs text-muted-foreground mb-1">Realized P&L</p>
          <p className={`text-lg font-semibold ${totalRealizedPl >= 0 ? 'text-success' : 'text-destructive'}`}>
            {formatBDT(totalRealizedPl)}
          </p>
        </div>
        <div className="bg-card rounded-lg border border-border p-4">
          <p className="text-xs text-muted-foreground mb-1">Cash Balance</p>
          <p className="text-lg font-semibold">{formatBDT(cashBalance)}</p>
        </div>
        <div className="bg-card rounded-lg border border-border p-4">
          <p className="text-xs text-muted-foreground mb-1">Net Equity</p>
          <p className="text-lg font-semibold">{formatBDT(netEquity)}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-border">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-[1px] ${
              tab === t.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="bg-card rounded-lg border border-border overflow-hidden">
        {tab === 'holdings' && (
          holdings.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No holdings.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground bg-muted/50">
                  <th className="p-3">Security</th>
                  <th className="p-3 text-right">Qty</th>
                  <th className="p-3 text-right">Avg Cost</th>
                  <th className="p-3 text-right">Live Price</th>
                  <th className="p-3 text-right">Market Value</th>
                  <th className="p-3 text-right">Unrealized P&L</th>
                  <th className="p-3 text-right">P&L %</th>
                </tr>
              </thead>
              <tbody>
                {holdings.map(h => {
                  const lastPrice = getLivePrice(h);
                  const code = h.security?.security_code;
                  const hasLive = code != null && livePrices[code] != null;
                  const mv = h.quantity * lastPrice;
                  const cost = h.quantity * h.average_cost;
                  const pl = mv - cost;
                  const plPct = cost > 0 ? (pl / cost) * 100 : 0;
                  return (
                    <tr key={h.isin} className="border-b border-border last:border-0">
                      <td className="p-3">
                        <div className="font-medium">{h.security?.security_code ?? h.isin}</div>
                        {h.security?.company_name && (
                          <div className="text-xs text-muted-foreground">{h.security.company_name}</div>
                        )}
                      </td>
                      <td className="p-3 text-right">{formatNumber(h.quantity, 0)}</td>
                      <td className="p-3 text-right">{formatNumber(h.average_cost)}</td>
                      <td className="p-3 text-right">
                        <span className={hasLive ? '' : 'text-muted-foreground'}>
                          {formatNumber(lastPrice)}
                        </span>
                        {hasLive && livePrices[code!] && (
                          <div className="text-[10px] text-muted-foreground">
                            {livePrices[code!].date}
                          </div>
                        )}
                      </td>
                      <td className="p-3 text-right">{formatBDT(mv)}</td>
                      <td className={`p-3 text-right ${pl >= 0 ? 'text-success' : 'text-destructive'}`}>
                        {formatBDT(pl)}
                      </td>
                      <td className={`p-3 text-right ${plPct >= 0 ? 'text-success' : 'text-destructive'}`}>
                        {formatPct(plPct)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                  <td className="p-3" colSpan={4}>Total</td>
                  <td className="p-3 text-right">{formatBDT(totalMarketValue)}</td>
                  <td className={`p-3 text-right ${unrealizedPl >= 0 ? 'text-success' : 'text-destructive'}`}>
                    {formatBDT(unrealizedPl)}
                  </td>
                  <td className={`p-3 text-right ${unrealizedPl >= 0 ? 'text-success' : 'text-destructive'}`}>
                    {totalCost > 0 ? formatPct((unrealizedPl / totalCost) * 100) : '—'}
                  </td>
                </tr>
              </tfoot>
            </table>
          )
        )}

        {tab === 'cash' && (
          cashEntries.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No cash transactions.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground bg-muted/50">
                  <th className="p-3">Date</th>
                  <th className="p-3">Type</th>
                  <th className="p-3 text-right">Amount</th>
                  <th className="p-3 text-right">Balance</th>
                  <th className="p-3">Reference</th>
                  <th className="p-3">Narration</th>
                </tr>
              </thead>
              <tbody>
                {cashEntries.map(e => (
                  <tr key={e.id} className="border-b border-border last:border-0">
                    <td className="p-3">{e.transaction_date}</td>
                    <td className="p-3">
                      <span className={`text-xs font-medium ${
                        e.amount >= 0 ? 'text-success' : 'text-destructive'
                      }`}>
                        {e.type}
                      </span>
                    </td>
                    <td className={`p-3 text-right ${e.amount >= 0 ? 'text-success' : 'text-destructive'}`}>
                      {formatBDT(e.amount)}
                    </td>
                    <td className="p-3 text-right">{formatBDT(e.running_balance)}</td>
                    <td className="p-3 text-xs text-muted-foreground">{e.reference || '—'}</td>
                    <td className="p-3 text-xs text-muted-foreground">{e.narration || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}

        {tab === 'trades' && (
          trades.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No trade history.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground bg-muted/50">
                  <th className="p-3">Date</th>
                  <th className="p-3">Security</th>
                  <th className="p-3">Side</th>
                  <th className="p-3 text-right">Qty</th>
                  <th className="p-3 text-right">Price</th>
                  <th className="p-3 text-right">Value</th>
                  <th className="p-3 text-right">Fees</th>
                  <th className="p-3 text-right">Net</th>
                </tr>
              </thead>
              <tbody>
                {trades.map(t => {
                  const totalFees = t.commission + t.exchange_fee + t.cdbl_fee + t.ait;
                  return (
                    <tr key={t.exec_id} className="border-b border-border last:border-0">
                      <td className="p-3">{t.trade_date}</td>
                      <td className="p-3 font-medium">{t.isin}</td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          t.side === 'BUY' ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive'
                        }`}>
                          {t.side}
                        </span>
                      </td>
                      <td className="p-3 text-right">{formatNumber(t.quantity, 0)}</td>
                      <td className="p-3 text-right">{formatNumber(t.price)}</td>
                      <td className="p-3 text-right">{formatBDT(t.value)}</td>
                      <td className="p-3 text-right text-muted-foreground">{formatBDT(totalFees)}</td>
                      <td className="p-3 text-right font-medium">{formatBDT(t.net_value)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        )}
      </div>
    </div>
  );
}
