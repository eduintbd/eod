import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Camera, ChevronLeft, ChevronRight } from 'lucide-react';
import { useDailySnapshots } from '@/hooks/useSnapshots';
import { formatBDT, formatNumber, formatMarginPct } from '@/lib/utils';

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function EodSnapshotsPage() {
  const [selectedDate, setSelectedDate] = useState<string | undefined>(undefined);
  const { snapshots, snapshotDate, loading, error } = useDailySnapshots(selectedDate);

  const totalPortfolio = snapshots.reduce((s, snap) => s + snap.total_portfolio_value, 0);
  const totalUnrealized = snapshots.reduce((s, snap) => s + snap.unrealized_pl, 0);

  return (
    <div>
      <Link to="/risk" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft size={16} /> Back to Risk Dashboard
      </Link>

      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Camera size={24} className="text-primary" />
          <h1 className="text-2xl font-bold">EOD Snapshots</h1>
        </div>
        <div className="flex items-center gap-2">
          {snapshotDate && (
            <>
              <button
                onClick={() => setSelectedDate(addDays(snapshotDate, -1))}
                className="p-1 rounded hover:bg-muted"
              >
                <ChevronLeft size={18} />
              </button>
              <input
                type="date"
                value={selectedDate ?? snapshotDate ?? ''}
                onChange={e => setSelectedDate(e.target.value)}
                className="px-3 py-1.5 text-sm border border-border rounded-md bg-background"
              />
              <button
                onClick={() => setSelectedDate(addDays(snapshotDate, 1))}
                className="p-1 rounded hover:bg-muted"
              >
                <ChevronRight size={18} />
              </button>
            </>
          )}
          <button
            disabled
            className="px-3 py-2 text-sm rounded-md bg-primary/50 text-primary-foreground cursor-not-allowed ml-2"
            title="Available after EOD processing is configured"
          >
            Run EOD
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-card rounded-lg border border-border p-5">
          <p className="text-sm text-muted-foreground mb-1">Snapshot Date</p>
          <p className="text-xl font-semibold">{snapshotDate ?? '—'}</p>
        </div>
        <div className="bg-card rounded-lg border border-border p-5">
          <p className="text-sm text-muted-foreground mb-1">Account Count</p>
          <p className="text-xl font-semibold">{formatNumber(snapshots.length, 0)}</p>
        </div>
        <div className="bg-card rounded-lg border border-border p-5">
          <p className="text-sm text-muted-foreground mb-1">Total Portfolio</p>
          <p className="text-xl font-semibold">{formatBDT(totalPortfolio)}</p>
        </div>
        <div className="bg-card rounded-lg border border-border p-5">
          <p className="text-sm text-muted-foreground mb-1">Total Unrealized P&L</p>
          <p className={`text-xl font-semibold ${totalUnrealized >= 0 ? 'text-success' : 'text-destructive'}`}>
            {formatBDT(totalUnrealized)}
          </p>
        </div>
      </div>

      {/* Snapshots Table */}
      <div className="bg-card rounded-lg border border-border overflow-hidden">
        {error && <p className="p-4 text-sm text-destructive">Error: {error}</p>}
        {loading ? (
          <p className="p-4 text-sm text-muted-foreground">Loading snapshots...</p>
        ) : snapshots.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <Camera size={40} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">No snapshots found for this date. Snapshots are generated during EOD processing.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground bg-muted/50">
                <th className="p-3">Client Code</th>
                <th className="p-3">Name</th>
                <th className="p-3 text-right">Portfolio Value</th>
                <th className="p-3 text-right">Cash</th>
                <th className="p-3 text-right">Loan</th>
                <th className="p-3 text-right">Net Equity</th>
                <th className="p-3 text-right">Margin %</th>
                <th className="p-3 text-right">Unrealized P&L</th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map(snap => {
                const marginPct = snap.margin_utilization_pct ?? 0;
                const marginColor = marginPct > 75 ? 'text-destructive' : marginPct > 50 ? 'text-orange-500' : 'text-success';
                return (
                  <tr key={snap.client_id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="p-3">
                      <Link to={`/clients/${snap.client_id}`} className="text-primary hover:underline font-medium">
                        {snap.client?.client_code ?? '—'}
                      </Link>
                    </td>
                    <td className="p-3">{snap.client?.name ?? '—'}</td>
                    <td className="p-3 text-right">{formatBDT(snap.total_portfolio_value)}</td>
                    <td className="p-3 text-right">{formatBDT(snap.cash_balance)}</td>
                    <td className="p-3 text-right">{formatBDT(snap.loan_balance)}</td>
                    <td className="p-3 text-right font-medium">{formatBDT(snap.net_equity)}</td>
                    <td className={`p-3 text-right font-medium ${marginColor}`}>
                      {formatMarginPct(marginPct / 100)}
                    </td>
                    <td className={`p-3 text-right ${snap.unrealized_pl >= 0 ? 'text-success' : 'text-destructive'}`}>
                      {formatBDT(snap.unrealized_pl)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
