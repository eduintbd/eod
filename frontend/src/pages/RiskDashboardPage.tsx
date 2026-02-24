import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Shield, Users, AlertTriangle, XCircle, CheckCircle, Camera } from 'lucide-react';
import { useMarginAccounts } from '@/hooks/useMarginData';
import { formatBDT, formatMarginPct, getMarginStatusColor } from '@/lib/utils';

const STATUS_TABS = ['ALL', 'NORMAL', 'MARGIN_CALL', 'FORCE_SELL'] as const;

export function RiskDashboardPage() {
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const { accounts, loading, error } = useMarginAccounts(statusFilter);

  // Fetch all for summary counts (unfiltered)
  const { accounts: allAccounts } = useMarginAccounts('ALL');

  const counts = {
    total: allAccounts.length,
    NORMAL: allAccounts.filter(a => a.maintenance_status === 'NORMAL').length,
    WARNING: allAccounts.filter(a => a.maintenance_status === 'WARNING').length,
    MARGIN_CALL: allAccounts.filter(a => a.maintenance_status === 'MARGIN_CALL').length,
    FORCE_SELL: allAccounts.filter(a => a.maintenance_status === 'FORCE_SELL').length,
  };

  const totalPortfolio = allAccounts.reduce((s, a) => s + a.portfolio_value, 0);
  const totalLoan = allAccounts.reduce((s, a) => s + a.loan_balance, 0);
  const aggregateEquity = totalPortfolio > 0 ? (totalPortfolio - totalLoan) / totalPortfolio : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Shield size={24} className="text-primary" />
          <h1 className="text-2xl font-bold">Risk & Margin Dashboard</h1>
        </div>
        <div className="flex gap-2">
          <Link
            to="/risk/snapshots"
            className="px-3 py-2 text-sm rounded-md border border-border hover:bg-muted transition-colors flex items-center gap-1"
          >
            <Camera size={14} /> View Snapshots
          </Link>
          <button
            disabled
            className="px-3 py-2 text-sm rounded-md bg-primary/50 text-primary-foreground cursor-not-allowed"
            title="Available after EOD processing is configured"
          >
            Run EOD
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-card rounded-lg border border-border p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-muted-foreground">Total Margin Accounts</span>
            <Users size={18} className="text-primary" />
          </div>
          <p className="text-2xl font-semibold">{counts.total}</p>
        </div>
        <div className="bg-card rounded-lg border border-border p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-muted-foreground">Normal</span>
            <CheckCircle size={18} className="text-success" />
          </div>
          <p className="text-2xl font-semibold text-success">{counts.NORMAL}</p>
        </div>
        <div className="bg-card rounded-lg border border-border p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-muted-foreground">Margin Call</span>
            <AlertTriangle size={18} className="text-orange-500" />
          </div>
          <p className="text-2xl font-semibold text-orange-500">{counts.MARGIN_CALL}</p>
        </div>
        <div className="bg-card rounded-lg border border-border p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-muted-foreground">Force Sell</span>
            <XCircle size={18} className="text-destructive" />
          </div>
          <p className="text-2xl font-semibold text-destructive">{counts.FORCE_SELL}</p>
        </div>
      </div>

      {/* Secondary Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="bg-card rounded-lg border border-border p-5">
          <p className="text-sm text-muted-foreground mb-1">Total Portfolio Value</p>
          <p className="text-xl font-semibold">{formatBDT(totalPortfolio)}</p>
        </div>
        <div className="bg-card rounded-lg border border-border p-5">
          <p className="text-sm text-muted-foreground mb-1">Total Loan Exposure</p>
          <p className="text-xl font-semibold">{formatBDT(totalLoan)}</p>
        </div>
        <div className="bg-card rounded-lg border border-border p-5">
          <p className="text-sm text-muted-foreground mb-1">Aggregate Equity Ratio</p>
          <p className="text-xl font-semibold">{formatMarginPct(aggregateEquity)}</p>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-1 mb-4 border-b border-border">
        {STATUS_TABS.map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-[1px] ${
              statusFilter === s
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {s === 'ALL' ? 'All' : s.replace('_', ' ')}
          </button>
        ))}
      </div>

      {/* Margin Accounts Table */}
      <div className="bg-card rounded-lg border border-border overflow-hidden">
        {error && (
          <p className="p-4 text-sm text-destructive">Error: {error}</p>
        )}
        {loading ? (
          <p className="p-4 text-sm text-muted-foreground">Loading margin accounts...</p>
        ) : accounts.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <Shield size={40} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">No margin accounts found. Data will appear after EOD processing.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground bg-muted/50">
                <th className="p-3">Client Code</th>
                <th className="p-3">Name</th>
                <th className="p-3 text-right">Portfolio Value</th>
                <th className="p-3 text-right">Loan Balance</th>
                <th className="p-3 text-right">Equity</th>
                <th className="p-3 text-right">Margin Ratio</th>
                <th className="p-3">Status</th>
                <th className="p-3">Last Call</th>
                <th className="p-3 text-right">Calls</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map(a => (
                <tr key={a.client_id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="p-3">
                    <Link to={`/clients/${a.client_id}`} className="text-primary hover:underline font-medium">
                      {a.client?.client_code ?? '—'}
                    </Link>
                  </td>
                  <td className="p-3">{a.client?.name ?? '—'}</td>
                  <td className="p-3 text-right">{formatBDT(a.portfolio_value)}</td>
                  <td className="p-3 text-right">{formatBDT(a.loan_balance)}</td>
                  <td className="p-3 text-right">{formatBDT(a.client_equity)}</td>
                  <td className="p-3 text-right">{formatMarginPct(a.margin_ratio)}</td>
                  <td className="p-3">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${getMarginStatusColor(a.maintenance_status)}`}>
                      {a.maintenance_status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="p-3 text-xs text-muted-foreground">{a.last_margin_call_date ?? '—'}</td>
                  <td className="p-3 text-right">{a.margin_call_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
