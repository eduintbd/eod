import { useEffect, useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Shield } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatBDT, formatNumber, formatPct, formatMarginPct, getMarginStatusColor } from '@/lib/utils';
import { useLatestPrices } from '@/hooks/useMarketData';
import { useMarginAccount } from '@/hooks/useMarginData';
import { useMarginAlerts } from '@/hooks/useAlerts';
import { useClientSnapshots } from '@/hooks/useSnapshots';
import type { Client, Holding, CashLedgerEntry, TradeExecution, Security } from '@/lib/types';

export function ClientDetailPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const [client, setClient] = useState<Client | null>(null);
  const [holdings, setHoldings] = useState<(Holding & { security?: Security })[]>([]);
  const [cashEntries, setCashEntries] = useState<CashLedgerEntry[]>([]);
  const [trades, setTrades] = useState<TradeExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'summary' | 'holdings' | 'cash' | 'trades' | 'margin' | 'portfolio'>('summary');
  const [unsettledBuyMap, setUnsettledBuyMap] = useState<Record<string, number>>({});

  // Summary tab state
  const [summaryFrom, setSummaryFrom] = useState('');
  const [summaryTo, setSummaryTo] = useState('');
  const [summaryTrades, setSummaryTrades] = useState<TradeExecution[]>([]);
  const [openingBalance, setOpeningBalance] = useState(0);
  const [totalDeposit, setTotalDeposit] = useState(0);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [securitiesMap, setSecuritiesMap] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!clientId) return;

    async function load() {
      const today = new Date().toISOString().slice(0, 10);
      const [clientRes, holdingsRes, cashRes, tradesRes, unsettledRes] = await Promise.all([
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
        // Fetch unsettled BUY trades to compute saleable quantity
        supabase
          .from('trade_executions')
          .select('isin, quantity')
          .eq('client_id', clientId)
          .eq('side', 'BUY')
          .gt('settlement_date', today),
      ]);

      // Build map of isin -> total unsettled buy quantity
      const buyMap: Record<string, number> = {};
      for (const row of (unsettledRes.data ?? [])) {
        buyMap[row.isin] = (buyMap[row.isin] || 0) + row.quantity;
      }
      setUnsettledBuyMap(buyMap);

      setClient(clientRes.data as Client | null);
      setHoldings((holdingsRes.data ?? []) as (Holding & { security?: Security })[]);
      setCashEntries((cashRes.data ?? []) as CashLedgerEntry[]);
      setTrades((tradesRes.data ?? []) as TradeExecution[]);
      setLoading(false);
    }
    load();
  }, [clientId]);

  // Initialize summary date range from latest trade date, or latest cash entry, or today
  useEffect(() => {
    if (summaryFrom) return;
    if (trades.length > 0) {
      setSummaryFrom(trades[0].trade_date);
      setSummaryTo(trades[0].trade_date);
    } else if (cashEntries.length > 0) {
      setSummaryFrom(cashEntries[0].transaction_date);
      setSummaryTo(cashEntries[0].transaction_date);
    } else if (!loading) {
      const today = new Date().toISOString().slice(0, 10);
      setSummaryFrom(today);
      setSummaryTo(today);
    }
  }, [trades, cashEntries, loading, summaryFrom]);

  // Load summary data when dates change
  useEffect(() => {
    if (!clientId || !summaryFrom || !summaryTo) return;

    async function loadSummary() {
      setSummaryLoading(true);
      const [balanceRes, balanceFallbackRes, tradesRes, depositRes, secRes] = await Promise.all([
        // Opening balance: last cash_ledger entry before from_date
        supabase
          .from('cash_ledger')
          .select('running_balance')
          .eq('client_id', clientId!)
          .lt('transaction_date', summaryFrom)
          .order('id', { ascending: false })
          .limit(1),
        // Fallback: last non-trade entry on or before from_date (for clients with no prior entries)
        supabase
          .from('cash_ledger')
          .select('running_balance')
          .eq('client_id', clientId!)
          .lte('transaction_date', summaryFrom)
          .not('type', 'in', '("BUY_TRADE","SELL_TRADE","COMMISSION","TAX")')
          .order('id', { ascending: false })
          .limit(1),
        // Trades in date range
        supabase
          .from('trade_executions')
          .select('*')
          .eq('client_id', clientId!)
          .gte('trade_date', summaryFrom)
          .lte('trade_date', summaryTo)
          .order('trade_date')
          .order('exec_id'),
        // Total deposits (all time)
        supabase
          .from('cash_ledger')
          .select('amount')
          .eq('client_id', clientId!)
          .eq('type', 'DEPOSIT'),
        // Securities lookup for codes
        supabase
          .from('securities')
          .select('isin, security_code'),
      ]);

      setOpeningBalance(
        balanceRes.data?.[0]?.running_balance
        ?? balanceFallbackRes.data?.[0]?.running_balance
        ?? 0
      );
      setSummaryTrades((tradesRes.data ?? []) as TradeExecution[]);
      setTotalDeposit(depositRes.data?.reduce((sum: number, d: { amount: number }) => sum + d.amount, 0) ?? 0);

      // Build isin → security_code map
      const map: Record<string, string> = {};
      for (const s of secRes.data ?? []) {
        if (s.security_code) map[s.isin] = s.security_code;
      }
      setSecuritiesMap(map);
      setSummaryLoading(false);
    }
    loadSummary();
  }, [clientId, summaryFrom, summaryTo]);

  // Extract security codes from holdings to fetch live prices
  const symbols = useMemo(
    () => holdings
      .map(h => h.security?.security_code)
      .filter((c): c is string => c != null),
    [holdings],
  );

  const { prices: livePrices, loading: pricesLoading } = useLatestPrices(symbols);

  // Margin data
  const { account: marginAccount, loading: marginLoading } = useMarginAccount(clientId);
  const { alerts: clientAlerts } = useMarginAlerts({ resolved: null, page: 0 });
  const filteredAlerts = clientAlerts.filter(a => a.client_id === clientId);
  const { snapshots: clientSnapshots } = useClientSnapshots(clientId, 10);

  // Compute summary running balances (must be before early returns — Rules of Hooks)
  const summaryRows = useMemo(() => {
    let balance = openingBalance;
    return summaryTrades.map(t => {
      const debit = t.side === 'BUY' ? t.net_value : 0;
      const credit = t.side === 'SELL' ? t.net_value : 0;
      balance = balance - debit + credit;
      return { ...t, debit, credit, balance };
    });
  }, [summaryTrades, openingBalance]);

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

  // Helper: get security code from isin
  function getSecCode(isin: string): string {
    if (securitiesMap[isin]) return securitiesMap[isin];
    if (isin.startsWith('DSE-')) return isin.slice(4);
    if (isin.startsWith('PLACEHOLDER-')) return isin.slice(12);
    return isin;
  }

  // Helper: format date as dd-Mon-yyyy
  function fmtDate(dateStr: string): string {
    const d = new Date(dateStr + 'T00:00:00');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${String(d.getDate()).padStart(2, '0')}-${months[d.getMonth()]}-${d.getFullYear()}`;
  }

  const totalDebit = summaryRows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = summaryRows.reduce((s, r) => s + r.credit, 0);
  const closingBalance = openingBalance - totalDebit + totalCredit;

  const tabs = [
    { key: 'summary' as const, label: 'Summary' },
    { key: 'holdings' as const, label: `Holdings (${holdings.length})` },
    { key: 'cash' as const, label: 'Cash Ledger' },
    { key: 'trades' as const, label: 'Trade History' },
    { key: 'margin' as const, label: 'Margin' },
    { key: 'portfolio' as const, label: 'Portfolio Statement' },
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
        {tab === 'summary' && (
          <div className="p-6 space-y-6">
            {/* Company Header */}
            <div className="flex justify-between items-start border-b border-border pb-4">
              <div>
                <h2 className="text-xl font-bold">UCB Stock Brokerage Limited.</h2>
                <p className="text-sm font-semibold">TREC Holder: DSE #181 | CSE#015</p>
                <p className="text-xs text-muted-foreground">"BULUS CENTER" (17th floor, west side), Plot-CWS(A)1, Road No-34, Gulshan Avenue</p>
              </div>
              <div className="text-right text-xs text-muted-foreground space-y-0.5">
                <p>Phone : (+88) 09678-175175</p>
                <p>Email : info@ucbstock.com.bd</p>
                <p>Web : www.ucbstock.com.bd</p>
              </div>
            </div>

            {/* Title */}
            <h3 className="text-center text-base font-bold underline">Investor Ledger Statement Summary</h3>

            {/* Date Range Picker */}
            <div className="flex items-center gap-4 text-sm">
              <label className="font-semibold">From</label>
              <input
                type="date"
                value={summaryFrom}
                onChange={e => setSummaryFrom(e.target.value)}
                className="border border-border rounded px-2 py-1 bg-background text-foreground text-sm"
              />
              <label className="font-semibold">To</label>
              <input
                type="date"
                value={summaryTo}
                onChange={e => setSummaryTo(e.target.value)}
                className="border border-border rounded px-2 py-1 bg-background text-foreground text-sm"
              />
            </div>

            {/* Account Info Grid */}
            <div className="grid grid-cols-3 gap-x-8 gap-y-1 text-sm">
              <div className="flex gap-2">
                <span className="font-semibold min-w-[120px]">Account No</span>
                <span>: {client.client_code}</span>
              </div>
              <div className="flex gap-2">
                <span className="font-semibold min-w-[130px]">Account Type</span>
                <span>: {client.category === 'institution' ? 'Institutional Account' : client.category === 'foreign' ? 'Foreign Account' : 'Individual Account'}</span>
              </div>
              <div className="text-right">
                <span className="font-semibold">Receivable Amount : </span>
                <span>{formatNumber(0)}</span>
              </div>

              <div className="flex gap-2">
                <span className="font-semibold min-w-[120px]">BOID</span>
                <span>: {client.bo_id}</span>
              </div>
              <div className="flex gap-2">
                <span className="font-semibold min-w-[130px]">Account Status</span>
                <span>: {client.status === 'active' ? 'Active' : client.status === 'suspended' ? 'Suspended' : client.status === 'closed' ? 'Closed' : 'Pending Review'}</span>
              </div>
              <div className="text-right">
                <span className="font-semibold">Total Deposit : </span>
                <span>{formatNumber(totalDeposit)}</span>
              </div>

              <div className="flex gap-2">
                <span className="font-semibold min-w-[120px]">Account Name</span>
                <span>: {client.name}</span>
              </div>
              <div className="flex gap-2">
                <span className="font-semibold min-w-[130px]">Account Category</span>
                <span>: {client.account_type === 'Margin' ? 'Margin' : 'Non Margin'}</span>
              </div>
              <div className="text-right">
                <span className="font-bold">Opening Balance : </span>
                <span className="font-bold">{formatNumber(openingBalance)}</span>
              </div>
            </div>

            {/* Trades Table */}
            {summaryLoading ? (
              <p className="text-sm text-muted-foreground">Loading summary...</p>
            ) : (
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-y-2 border-foreground text-left bg-muted/50 font-bold">
                    <th className="p-2">Date</th>
                    <th className="p-2">Operation</th>
                    <th className="p-2">Details</th>
                    <th className="p-2 text-right">Quantity</th>
                    <th className="p-2 text-right">Rate</th>
                    <th className="p-2 text-right">Debit</th>
                    <th className="p-2 text-right">Credit</th>
                    <th className="p-2 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {summaryRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-4 text-center text-muted-foreground">
                        No trades found for the selected date range.
                      </td>
                    </tr>
                  ) : (
                    summaryRows.map(r => (
                      <tr key={r.exec_id} className="border-b border-border">
                        <td className="p-2">{fmtDate(r.trade_date)}</td>
                        <td className="p-2">{r.side === 'BUY' ? 'BUY' : 'SELL'}</td>
                        <td className="p-2">{r.side === 'BUY' ? 'Bought' : 'Sold'} {getSecCode(r.isin)}</td>
                        <td className="p-2 text-right">{formatNumber(r.quantity, 0)}</td>
                        <td className="p-2 text-right">{formatNumber(r.price, 4)}</td>
                        <td className="p-2 text-right">{formatNumber(r.debit)}</td>
                        <td className="p-2 text-right">{formatNumber(r.credit)}</td>
                        <td className="p-2 text-right">{formatNumber(r.balance)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
                {summaryRows.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-foreground font-bold">
                      <td className="p-2" colSpan={5} style={{ textAlign: 'right' }}>Closing Balance :</td>
                      <td className="p-2 text-right">{formatNumber(totalDebit)}</td>
                      <td className="p-2 text-right">{formatNumber(totalCredit)}</td>
                      <td className="p-2 text-right">{formatNumber(closingBalance)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            )}
          </div>
        )}

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

        {tab === 'margin' && (
          marginLoading ? (
            <p className="p-4 text-sm text-muted-foreground">Loading margin data...</p>
          ) : !marginAccount ? (
            <div className="p-8 text-center text-muted-foreground">
              <Shield size={40} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">This client does not have a margin account.</p>
            </div>
          ) : (
            <div className="p-4 space-y-6">
              {/* Margin Account Status */}
              <div>
                <h3 className="text-sm font-semibold mb-3">Margin Account Status</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div className="bg-muted/30 rounded-lg p-3">
                    <p className="text-xs text-muted-foreground mb-1">Loan Balance</p>
                    <p className="text-lg font-semibold">{formatBDT(marginAccount.loan_balance)}</p>
                  </div>
                  <div className="bg-muted/30 rounded-lg p-3">
                    <p className="text-xs text-muted-foreground mb-1">Total Portfolio Value</p>
                    <p className="text-lg font-semibold">{formatBDT(marginAccount.total_portfolio_value ?? marginAccount.portfolio_value)}</p>
                  </div>
                  <div className="bg-muted/30 rounded-lg p-3">
                    <p className="text-xs text-muted-foreground mb-1">Marginable Portfolio</p>
                    <p className="text-lg font-semibold">
                      {marginAccount.marginable_portfolio_value != null
                        ? formatBDT(marginAccount.marginable_portfolio_value)
                        : '—'}
                    </p>
                  </div>
                  <div className="bg-muted/30 rounded-lg p-3">
                    <p className="text-xs text-muted-foreground mb-1">Client Equity</p>
                    <p className="text-lg font-semibold">{formatBDT(marginAccount.client_equity)}</p>
                  </div>
                  <div className="bg-muted/30 rounded-lg p-3">
                    <p className="text-xs text-muted-foreground mb-1">Margin Ratio</p>
                    <p className="text-lg font-semibold">{formatMarginPct(marginAccount.margin_ratio)}</p>
                  </div>
                  <div className="bg-muted/30 rounded-lg p-3">
                    <p className="text-xs text-muted-foreground mb-1">Applied Ratio</p>
                    <p className="text-lg font-semibold font-mono">{marginAccount.applied_ratio ?? '—'}</p>
                  </div>
                  <div className="bg-muted/30 rounded-lg p-3">
                    <p className="text-xs text-muted-foreground mb-1">Status</p>
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${getMarginStatusColor(marginAccount.maintenance_status)}`}>
                      {marginAccount.maintenance_status.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="bg-muted/30 rounded-lg p-3">
                    <p className="text-xs text-muted-foreground mb-1">Margin Call Deadline</p>
                    <p className={`text-lg font-semibold ${marginAccount.margin_call_deadline ? 'text-orange-500' : ''}`}>
                      {marginAccount.margin_call_deadline ?? '—'}
                    </p>
                  </div>
                  <div className="bg-muted/30 rounded-lg p-3">
                    <p className="text-xs text-muted-foreground mb-1">Margin Call Count</p>
                    <p className="text-lg font-semibold">{marginAccount.margin_call_count}</p>
                  </div>
                </div>
              </div>

              {/* Alert History */}
              <div>
                <h3 className="text-sm font-semibold mb-3">Alert History</h3>
                {filteredAlerts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No alerts for this client.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-muted-foreground">
                        <th className="p-2">Date</th>
                        <th className="p-2">Type</th>
                        <th className="p-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAlerts.slice(0, 10).map(a => (
                        <tr key={a.id} className="border-b border-border last:border-0">
                          <td className="p-2 text-xs">{a.alert_date}</td>
                          <td className="p-2">
                            <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${getMarginStatusColor(a.alert_type)}`}>
                              {a.alert_type.replace('_', ' ')}
                            </span>
                          </td>
                          <td className="p-2 text-xs">{a.resolved ? 'Resolved' : 'Active'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Snapshot Trend */}
              <div>
                <h3 className="text-sm font-semibold mb-3">Snapshot Trend</h3>
                {clientSnapshots.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No snapshot history available.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-muted-foreground">
                        <th className="p-2">Date</th>
                        <th className="p-2 text-right">Portfolio</th>
                        <th className="p-2 text-right">Cash</th>
                        <th className="p-2 text-right">Loan</th>
                        <th className="p-2 text-right">Equity</th>
                        <th className="p-2 text-right">Margin %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {clientSnapshots.map(snap => (
                        <tr key={snap.snapshot_date} className="border-b border-border last:border-0">
                          <td className="p-2 text-xs">{snap.snapshot_date}</td>
                          <td className="p-2 text-right">{formatBDT(snap.total_portfolio_value)}</td>
                          <td className="p-2 text-right">{formatBDT(snap.cash_balance)}</td>
                          <td className="p-2 text-right">{formatBDT(snap.loan_balance)}</td>
                          <td className="p-2 text-right">{formatBDT(snap.net_equity)}</td>
                          <td className="p-2 text-right">{formatMarginPct((snap.margin_utilization_pct ?? 0) / 100)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )
        )}

        {tab === 'portfolio' && (() => {
          const today = new Date();
          const dateStr = `${String(today.getDate()).padStart(2, '0')}-${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][today.getMonth()]}-${today.getFullYear()}`;

          // Separate holdings by marginability
          const nonMarginable = holdings.filter(h => !h.security?.is_marginable);
          const marginable = holdings.filter(h => h.security?.is_marginable);

          // Compute per-holding data
          function holdingRow(h: (typeof holdings)[0]) {
            const lp = getLivePrice(h);
            const cost = h.quantity * h.average_cost;
            const mv = h.quantity * lp;
            const ugl = mv - cost;
            const pctGain = cost > 0 ? (ugl / cost) * 100 : 0;
            const pctMv = totalMarketValue > 0 ? (mv / totalMarketValue) * 100 : 0;
            const saleable = h.quantity - (unsettledBuyMap[h.isin] || 0);
            return { lp, cost, mv, ugl, pctGain, pctMv, saleable };
          }

          function sectionTotal(group: typeof holdings) {
            return group.reduce((acc, h) => {
              const r = holdingRow(h);
              acc.cost += r.cost;
              acc.mv += r.mv;
              acc.ugl += r.ugl;
              acc.pctMv += r.pctMv;
              return acc;
            }, { cost: 0, mv: 0, ugl: 0, pctMv: 0 });
          }

          sectionTotal(nonMarginable); // included in grand total
          const margTotal = sectionTotal(marginable);

          // Account status calculations
          const receivableSales = 0; // placeholder
          const ledgerBalance = cashBalance + receivableSales;
          const accruedFees = 0;
          const currentAssetLiabilities = ledgerBalance + accruedFees;
          const marginableEquity = margTotal.mv;
          const totalEquityVal = currentAssetLiabilities + totalMarketValue;
          const loanRatio = marginAccount?.loan_balance ? (marginAccount.loan_balance / totalEquityVal) : 0;
          const purchasePower = currentAssetLiabilities > 0 ? currentAssetLiabilities : 0;
          const netAssetValue = totalEquityVal;

          // Deposit & withdrawal
          const realizedGainLoss = totalRealizedPl;
          const adjustedDeposit = totalDeposit + realizedGainLoss;
          const netDepositVal = adjustedDeposit;
          const netGainLoss = unrealizedPl + realizedGainLoss;

          let sn = 0;

          return (
            <div className="p-6 space-y-6">
              {/* Company Header */}
              <div className="flex justify-between items-start border-b border-border pb-4">
                <div>
                  <h2 className="text-xl font-bold">UCB Stock Brokerage Limited.</h2>
                  <p className="text-sm font-semibold">TREC Holder: DSE #181 | CSE#015</p>
                  <p className="text-xs text-muted-foreground">"BULUS CENTER" (17th floor, west side), Plot-CWS(A)1, Road No-34, Gulshan Avenue</p>
                  <p className="text-xs text-muted-foreground">Phone : (+88) 09678-175175, Fax : N.A.</p>
                  <p className="text-xs text-muted-foreground">Email : info@ucbstock.com.bd, Web : www.ucbstock.com.bd</p>
                </div>
              </div>

              {/* Title */}
              <h3 className="text-center text-base font-bold underline">Portfolio Statement</h3>

              {/* Client Info Grid */}
              <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
                <div className="flex gap-2">
                  <span className="font-semibold min-w-[140px]">Name</span>
                  <span>: {client.name}</span>
                </div>
                <div className="flex gap-2">
                  <span className="font-semibold min-w-[140px]">Date</span>
                  <span>: {dateStr}</span>
                </div>
                <div className="flex gap-2">
                  <span className="font-semibold min-w-[140px]">Investor Code</span>
                  <span>: {client.client_code}</span>
                </div>
                <div className="flex gap-2">
                  <span className="font-semibold min-w-[140px]">Account Type</span>
                  <span>: {client.category === 'institution' ? 'Institutional Account' : client.category === 'foreign' ? 'Foreign Account' : 'Individual Account'}</span>
                </div>
                <div className="flex gap-2">
                  <span className="font-semibold min-w-[140px]">BOID</span>
                  <span>: {client.bo_id}</span>
                </div>
                <div className="flex gap-2">
                  <span className="font-semibold min-w-[140px]">Account Status</span>
                  <span>: {client.status === 'active' ? 'Active' : client.status === 'suspended' ? 'Suspended' : client.status === 'closed' ? 'Closed' : 'Pending Review'}</span>
                </div>
                <div />
                <div className="flex gap-2">
                  <span className="font-semibold min-w-[140px]">Account Category</span>
                  <span>: {client.account_type === 'Margin' ? 'Margin' : 'Non Margin'}</span>
                </div>
              </div>

              {/* Holdings Table */}
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-y-2 border-foreground text-left bg-muted/50 font-bold">
                    <th className="p-1.5">SN</th>
                    <th className="p-1.5">Instrument</th>
                    <th className="p-1.5">Group</th>
                    <th className="p-1.5 text-right">Qty Total</th>
                    <th className="p-1.5 text-right">Qty Saleable</th>
                    <th className="p-1.5 text-right">Avg Cost</th>
                    <th className="p-1.5 text-right">Total Cost (TK.)</th>
                    <th className="p-1.5 text-right">Market Rate</th>
                    <th className="p-1.5 text-right">Market Value (TK.)</th>
                    <th className="p-1.5 text-right">Unrealized Gain/(Loss)</th>
                    <th className="p-1.5 text-right">%Gain/(Loss)</th>
                    <th className="p-1.5 text-right">%Mkt Value</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Non Marginable Section */}
                  {nonMarginable.length > 0 && (
                    <>
                      <tr className="bg-muted/30">
                        <td colSpan={12} className="p-1.5 font-bold text-xs">Non Marginable Instrument</td>
                      </tr>
                      {nonMarginable.map(h => {
                        sn++;
                        const r = holdingRow(h);
                        return (
                          <tr key={h.isin} className="border-b border-border">
                            <td className="p-1.5">{sn}</td>
                            <td className="p-1.5">{h.security?.security_code ?? h.isin}</td>
                            <td className="p-1.5">{h.security?.category ?? '—'}</td>
                            <td className="p-1.5 text-right">{formatNumber(h.quantity, 0)}</td>
                            <td className="p-1.5 text-right">{formatNumber(r.saleable, 0)}</td>
                            <td className="p-1.5 text-right">{formatNumber(h.average_cost)}</td>
                            <td className="p-1.5 text-right">{formatNumber(r.cost)}</td>
                            <td className="p-1.5 text-right">{formatNumber(r.lp)}</td>
                            <td className="p-1.5 text-right">{formatNumber(r.mv)}</td>
                            <td className={`p-1.5 text-right ${r.ugl >= 0 ? '' : 'text-destructive'}`}>{formatNumber(r.ugl)}</td>
                            <td className={`p-1.5 text-right ${r.pctGain >= 0 ? '' : 'text-destructive'}`}>{formatNumber(r.pctGain, 2)}</td>
                            <td className="p-1.5 text-right">{formatNumber(r.pctMv, 2)}</td>
                          </tr>
                        );
                      })}
                    </>
                  )}

                  {/* Marginable Section */}
                  {marginable.length > 0 && (
                    <>
                      <tr className="bg-muted/30">
                        <td colSpan={12} className="p-1.5 font-bold text-xs">Marginable Instrument</td>
                      </tr>
                      {marginable.map(h => {
                        sn++;
                        const r = holdingRow(h);
                        return (
                          <tr key={h.isin} className="border-b border-border">
                            <td className="p-1.5">{sn}</td>
                            <td className="p-1.5">{h.security?.security_code ?? h.isin}</td>
                            <td className="p-1.5">{h.security?.category ?? '—'}</td>
                            <td className="p-1.5 text-right">{formatNumber(h.quantity, 0)}</td>
                            <td className="p-1.5 text-right">{formatNumber(r.saleable, 0)}</td>
                            <td className="p-1.5 text-right">{formatNumber(h.average_cost)}</td>
                            <td className="p-1.5 text-right">{formatNumber(r.cost)}</td>
                            <td className="p-1.5 text-right">{formatNumber(r.lp)}</td>
                            <td className="p-1.5 text-right">{formatNumber(r.mv)}</td>
                            <td className={`p-1.5 text-right ${r.ugl >= 0 ? '' : 'text-destructive'}`}>{formatNumber(r.ugl)}</td>
                            <td className={`p-1.5 text-right ${r.pctGain >= 0 ? '' : 'text-destructive'}`}>{formatNumber(r.pctGain, 2)}</td>
                            <td className="p-1.5 text-right">{formatNumber(r.pctMv, 2)}</td>
                          </tr>
                        );
                      })}
                    </>
                  )}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-foreground font-bold">
                    <td className="p-1.5" colSpan={6} style={{ textAlign: 'right' }}>Total:</td>
                    <td className="p-1.5 text-right">{formatNumber(totalCost)}</td>
                    <td className="p-1.5" />
                    <td className="p-1.5 text-right">{formatNumber(totalMarketValue)}</td>
                    <td className={`p-1.5 text-right ${unrealizedPl >= 0 ? '' : 'text-destructive'}`}>{formatNumber(unrealizedPl)}</td>
                    <td className="p-1.5" />
                    <td className="p-1.5" />
                  </tr>
                  <tr className="border-t border-foreground font-bold bg-muted/30">
                    <td className="p-1.5" colSpan={6} style={{ textAlign: 'right' }}>Grand Total:</td>
                    <td className="p-1.5 text-right">{formatNumber(totalCost)}</td>
                    <td className="p-1.5" />
                    <td className="p-1.5 text-right">{formatNumber(totalMarketValue)}</td>
                    <td className={`p-1.5 text-right ${unrealizedPl >= 0 ? '' : 'text-destructive'}`}>{formatNumber(unrealizedPl)}</td>
                    <td className="p-1.5" />
                    <td className="p-1.5" />
                  </tr>
                </tfoot>
              </table>

              {/* Account Status Till Today */}
              <div>
                <h4 className="text-sm font-bold border-b border-foreground pb-1 mb-2">Account Status Till Today</h4>
                <div className="grid grid-cols-2 gap-x-12 text-sm">
                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <span>Mature Balance</span>
                      <span>: {formatNumber(cashBalance)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Receivable Sales</span>
                      <span>: {formatNumber(receivableSales)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Cheque In Hand/Transit</span>
                      <span>: {formatNumber(0)}</span>
                    </div>
                    <div className="flex justify-between font-bold border-t border-border pt-1">
                      <span>Ledger Balance</span>
                      <span>: {formatNumber(ledgerBalance)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Accrued Fees & Charges</span>
                      <span>: {formatNumber(accruedFees)}</span>
                    </div>
                    <div className="flex justify-between font-bold border-t border-border pt-1">
                      <span>Current Asset/Liabilities</span>
                      <span>: {formatNumber(currentAssetLiabilities)}</span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <span>Market Value of Securities</span>
                      <span>: {formatNumber(totalMarketValue)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Equity (Marginable)</span>
                      <span>: {formatNumber(marginableEquity)}</span>
                    </div>
                    <div className="flex justify-between font-bold border-t border-border pt-1">
                      <span>Total Equity</span>
                      <span>: {formatNumber(totalEquityVal)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Loan Ratio</span>
                      <span>: {formatNumber(loanRatio, 4)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Purchase Power</span>
                      <span>: {formatNumber(purchasePower)}</span>
                    </div>
                    <div className="flex justify-between font-bold border-t border-border pt-1">
                      <span>Net Asset Value</span>
                      <span>: {formatNumber(netAssetValue)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Deposit & Withdrawal Status */}
              <div>
                <h4 className="text-sm font-bold border-b border-foreground pb-1 mb-2">Deposit & Withdrawal Status</h4>
                <div className="grid grid-cols-2 gap-x-12 text-sm">
                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <span>Deposit</span>
                      <span>: {formatNumber(totalDeposit)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Realized Gain/(Loss)</span>
                      <span>: {formatNumber(realizedGainLoss)}</span>
                    </div>
                    <div className="flex justify-between font-bold border-t border-border pt-1">
                      <span>Adjusted Deposit</span>
                      <span>: {formatNumber(adjustedDeposit)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Withdrawal</span>
                      <span>: {formatNumber(0)}</span>
                    </div>
                    <div className="flex justify-between font-bold border-t border-border pt-1">
                      <span>Net Deposit</span>
                      <span>: {formatNumber(netDepositVal)}</span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <span>Realized Gain/Loss As On</span>
                      <span>: {formatNumber(realizedGainLoss)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Unrealized Gain</span>
                      <span>: {formatNumber(unrealizedPl)}</span>
                    </div>
                    <div className="flex justify-between font-bold border-t border-border pt-1">
                      <span>Net Gain/Loss</span>
                      <span>: {formatNumber(netGainLoss)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Realized Gain/Loss Fin. Year</span>
                      <span>: {formatNumber(realizedGainLoss)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Cash Dividend Receivable */}
              <div>
                <h4 className="text-sm font-bold border-b border-foreground pb-1 mb-2">Cash Dividend Receivable</h4>
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-y border-foreground text-left bg-muted/50 font-bold">
                      <th className="p-1.5">Instrument Code</th>
                      <th className="p-1.5">Category</th>
                      <th className="p-1.5 text-right">Cash Receivable</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td colSpan={3} className="p-3 text-center text-muted-foreground text-xs">
                        No dividend data available yet.
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
