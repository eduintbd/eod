import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { formatBDT, formatNumber } from '@/lib/utils';
import { Users, Briefcase, Wallet, FileText, TrendingUp, ArrowRight } from 'lucide-react';
import { useAllLatestPrices } from '@/hooks/useMarketData';

interface DashboardStats {
  totalClients: number;
  totalSecurities: number;
  totalPortfolioValue: number;
  totalCashBalance: number;
  recentImports: Array<{
    id: number;
    file_name: string;
    file_type: string;
    status: string;
    import_date: string;
    total_rows: number;
    processed_rows: number;
  }>;
}

export function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const { prices: marketPrices, latestDate, loading: marketLoading } = useAllLatestPrices();

  useEffect(() => {
    async function load() {
      const [clientRes, secRes, holdingsRes, cashRes, importRes] = await Promise.all([
        supabase.from('clients').select('client_id', { count: 'exact', head: true }),
        supabase.from('securities').select('isin', { count: 'exact', head: true }),
        supabase.from('holdings').select('quantity, average_cost'),
        supabase.from('cash_ledger').select('client_id, running_balance').order('id', { ascending: false }),
        supabase.from('import_audit').select('*').order('import_date', { ascending: false }).limit(5),
      ]);

      // Compute total portfolio value from holdings
      let totalPortfolioValue = 0;
      if (holdingsRes.data) {
        for (const h of holdingsRes.data) {
          totalPortfolioValue += (h.quantity ?? 0) * (h.average_cost ?? 0);
        }
      }

      // Get latest cash balance per client (deduplicate by client_id)
      const clientCash = new Map<string, number>();
      if (cashRes.data) {
        for (const entry of cashRes.data) {
          if (!clientCash.has(entry.client_id)) {
            clientCash.set(entry.client_id, entry.running_balance);
          }
        }
      }
      const totalCashBalance = Array.from(clientCash.values()).reduce((sum, v) => sum + v, 0);

      setStats({
        totalClients: clientRes.count ?? 0,
        totalSecurities: secRes.count ?? 0,
        totalPortfolioValue,
        totalCashBalance,
        recentImports: (importRes.data ?? []) as DashboardStats['recentImports'],
      });
      setLoading(false);
    }
    load();
  }, []);

  if (loading) {
    return <div className="text-muted-foreground">Loading dashboard...</div>;
  }

  if (!stats) return null;

  // Compute market summary from live prices
  const totalMarketVolume = marketPrices.reduce((s, p) => s + (p.volume ?? 0), 0);
  const topGainers = [...marketPrices]
    .filter(p => p.close > 0)
    .sort((a, b) => b.close - a.close)
    .slice(0, 5);

  const cards = [
    { label: 'Total Clients', value: formatNumber(stats.totalClients, 0), icon: Users, color: 'text-info' },
    { label: 'Securities', value: formatNumber(stats.totalSecurities, 0), icon: Briefcase, color: 'text-success' },
    { label: 'Portfolio Value (Cost)', value: formatBDT(stats.totalPortfolioValue), icon: Briefcase, color: 'text-primary' },
    { label: 'Total Cash Balance', value: formatBDT(stats.totalCashBalance), icon: Wallet, color: 'text-warning' },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {cards.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-card rounded-lg border border-border p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-muted-foreground">{label}</span>
              <Icon size={18} className={color} />
            </div>
            <p className="text-xl font-semibold">{value}</p>
          </div>
        ))}
      </div>

      {/* Market Data Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="bg-card rounded-lg border border-border">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp size={18} className="text-primary" />
              <h2 className="font-semibold">DSE Market Overview</h2>
            </div>
            <Link to="/market" className="text-xs text-primary flex items-center gap-1 hover:underline">
              View All <ArrowRight size={12} />
            </Link>
          </div>
          {marketLoading ? (
            <p className="p-4 text-sm text-muted-foreground">Loading market data...</p>
          ) : (
            <div className="p-4">
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <p className="text-xs text-muted-foreground">Latest Date</p>
                  <p className="text-sm font-medium">{latestDate ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Stocks Traded</p>
                  <p className="text-sm font-medium">{formatNumber(marketPrices.length, 0)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total Volume</p>
                  <p className="text-sm font-medium">{formatNumber(totalMarketVolume, 0)}</p>
                </div>
              </div>
              {topGainers.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Top by Price</p>
                  <div className="space-y-1">
                    {topGainers.map(p => (
                      <div key={p.symbol} className="flex justify-between text-sm">
                        <span className="font-medium">{p.symbol}</span>
                        <span>{formatNumber(p.close)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Recent Imports */}
        <div className="bg-card rounded-lg border border-border">
          <div className="p-4 border-b border-border flex items-center gap-2">
            <FileText size={18} />
            <h2 className="font-semibold">Recent Imports</h2>
          </div>
          {stats.recentImports.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No imports yet. Go to Import Data to upload files.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="p-3">File</th>
                  <th className="p-3">Type</th>
                  <th className="p-3">Rows</th>
                  <th className="p-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {stats.recentImports.map(imp => (
                  <tr key={imp.id} className="border-b border-border last:border-0">
                    <td className="p-3 font-medium truncate max-w-[180px]">{imp.file_name}</td>
                    <td className="p-3 text-xs">{imp.file_type}</td>
                    <td className="p-3">{imp.processed_rows}/{imp.total_rows}</td>
                    <td className="p-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                        imp.status === 'SUCCESS' ? 'bg-success/10 text-success' :
                        imp.status === 'FAILED' ? 'bg-destructive/10 text-destructive' :
                        imp.status === 'PROCESSING' ? 'bg-info/10 text-info' :
                        'bg-warning/10 text-warning'
                      }`}>
                        {imp.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
