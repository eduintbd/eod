import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Camera, ChevronLeft, ChevronRight, Play, CheckCircle, XCircle, Loader2, AlertTriangle } from 'lucide-react';
import { useDailySnapshots } from '@/hooks/useSnapshots';
import { useEod } from '@/hooks/useEod';
import { formatBDT, formatNumber, formatMarginPct } from '@/lib/utils';

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function EodSnapshotsPage() {
  const [selectedDate, setSelectedDate] = useState<string | undefined>(undefined);
  const { snapshots, snapshotDate, loading, error } = useDailySnapshots(selectedDate);

  const {
    preflight, preflightLoading, fetchPreflight,
    progress, runEod, resetProgress,
    history, historyLoading, fetchHistory,
  } = useEod();

  const [showPreflight, setShowPreflight] = useState(false);
  const [showResult, setShowResult] = useState(false);

  // Load EOD history on mount
  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  // Show result dialog when EOD completes
  useEffect(() => {
    if (progress.status === 'completed' || progress.status === 'error') {
      setShowResult(true);
    }
  }, [progress.status]);

  const eodDate = selectedDate ?? snapshotDate ?? '';

  const handleRunEodClick = async () => {
    if (!eodDate) return;
    try {
      await fetchPreflight(eodDate);
      setShowPreflight(true);
    } catch (err) {
      alert(`Preflight failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleConfirmEod = async () => {
    setShowPreflight(false);
    const force = preflight?.already_run ?? false;
    try {
      await runEod(eodDate, force);
      fetchHistory();
      // Refresh snapshots for this date
      setSelectedDate(eodDate);
    } catch (_) {
      // Error already in progress state
    }
  };

  const handleCloseResult = () => {
    setShowResult(false);
    resetProgress();
  };

  const totalPortfolio = snapshots.reduce((s, snap) => s + snap.total_portfolio_value, 0);
  const totalUnrealized = snapshots.reduce((s, snap) => s + snap.unrealized_pl, 0);

  const isRunning = progress.status === 'running';

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
          {!snapshotDate && (
            <input
              type="date"
              value={selectedDate ?? ''}
              onChange={e => setSelectedDate(e.target.value)}
              className="px-3 py-1.5 text-sm border border-border rounded-md bg-background"
            />
          )}
          <button
            onClick={handleRunEodClick}
            disabled={isRunning || preflightLoading || !eodDate}
            className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed ml-2"
          >
            {isRunning ? (
              <><Loader2 size={14} className="animate-spin" /> Running...</>
            ) : preflightLoading ? (
              <><Loader2 size={14} className="animate-spin" /> Checking...</>
            ) : (
              <><Play size={14} /> Run EOD</>
            )}
          </button>
        </div>
      </div>

      {/* Progress Bar (during EOD run) */}
      {isRunning && (
        <div className="bg-card rounded-lg border border-border p-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" />
              Running EOD for {eodDate}...
            </span>
            <span className="text-sm text-muted-foreground">
              Batch {progress.currentBatch} &middot; {progress.clientsProcessed} clients processed
            </span>
          </div>
          <div className="w-full bg-muted rounded-full h-2">
            <div
              className="bg-primary h-2 rounded-full transition-all duration-300"
              style={{
                width: progress.totalClients > 0
                  ? `${Math.min((progress.clientsProcessed / progress.totalClients) * 100, 100)}%`
                  : '0%'
              }}
            />
          </div>
          <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
            <span>Snapshots: {progress.snapshotsCreated}</span>
            <span>Alerts: {progress.alertsGenerated}</span>
            {progress.errors.length > 0 && (
              <span className="text-destructive">Errors: {progress.errors.length}</span>
            )}
          </div>
        </div>
      )}

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
            <p className="text-sm">No snapshots found for this date. Click "Run EOD" to generate snapshots.</p>
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

      {/* EOD Run History */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold mb-3">EOD Run History</h2>
        <div className="bg-card rounded-lg border border-border overflow-hidden">
          {historyLoading ? (
            <p className="p-4 text-sm text-muted-foreground">Loading history...</p>
          ) : history.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No EOD runs recorded yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground bg-muted/50">
                  <th className="p-3">Date</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Clients</th>
                  <th className="p-3 text-right">Snapshots</th>
                  <th className="p-3 text-right">Alerts</th>
                  <th className="p-3 text-right">Portfolio Value</th>
                  <th className="p-3 text-right">Cash Balance</th>
                  <th className="p-3">Completed</th>
                </tr>
              </thead>
              <tbody>
                {history.map(run => (
                  <tr
                    key={run.id}
                    className="border-b border-border last:border-0 hover:bg-muted/30 cursor-pointer"
                    onClick={() => setSelectedDate(run.eod_date)}
                  >
                    <td className="p-3 font-medium">{run.eod_date}</td>
                    <td className="p-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                        run.status === 'COMPLETED' ? 'bg-success/10 text-success' :
                        run.status === 'RUNNING' ? 'bg-primary/10 text-primary' :
                        'bg-destructive/10 text-destructive'
                      }`}>
                        {run.status === 'COMPLETED' && <CheckCircle size={12} />}
                        {run.status === 'RUNNING' && <Loader2 size={12} className="animate-spin" />}
                        {run.status === 'FAILED' && <XCircle size={12} />}
                        {run.status}
                      </span>
                    </td>
                    <td className="p-3 text-right">{formatNumber(run.total_clients, 0)}</td>
                    <td className="p-3 text-right">{formatNumber(run.snapshots_created, 0)}</td>
                    <td className="p-3 text-right">{formatNumber(run.margin_alerts_generated, 0)}</td>
                    <td className="p-3 text-right">{formatBDT(run.total_portfolio_value)}</td>
                    <td className="p-3 text-right">{formatBDT(run.total_cash_balance)}</td>
                    <td className="p-3 text-muted-foreground">
                      {run.completed_at
                        ? new Date(run.completed_at).toLocaleString()
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Preflight Dialog */}
      {showPreflight && preflight && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border border-border rounded-lg shadow-lg w-full max-w-md mx-4">
            <div className="p-6">
              <h3 className="text-lg font-semibold mb-4">EOD Pre-flight Check — {eodDate}</h3>

              <div className="space-y-3 mb-6">
                <PreflightRow
                  label="Total Active Clients"
                  value={formatNumber(preflight.total_clients, 0)}
                />
                <PreflightRow
                  label="Trades Processed"
                  value={formatNumber(preflight.trades_for_date, 0)}
                />
                <PreflightRow
                  label="Unprocessed Trades"
                  value={formatNumber(preflight.unprocessed_trades, 0)}
                  status={preflight.unprocessed_trades === 0 ? 'ok' : 'warn'}
                />
                <PreflightRow
                  label="Deposits/Withdrawals"
                  value={formatNumber(preflight.deposits_for_date, 0)}
                />
                <PreflightRow
                  label="Prices Available"
                  value={preflight.prices_available ? 'Yes' : 'No'}
                  status={preflight.prices_available ? 'ok' : 'warn'}
                />
                {preflight.already_run && (
                  <div className="flex items-center gap-2 text-sm text-orange-500">
                    <AlertTriangle size={14} />
                    <span>EOD already completed for this date. Will re-run (force mode).</span>
                  </div>
                )}
                {preflight.last_eod_date && (
                  <PreflightRow
                    label="Last EOD Date"
                    value={preflight.last_eod_date}
                  />
                )}
              </div>

              {preflight.unprocessed_trades > 0 && (
                <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md mb-4">
                  There are {preflight.unprocessed_trades} unprocessed trades. Process them before running EOD, or proceed with force mode.
                </div>
              )}

              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setShowPreflight(false)}
                  className="px-4 py-2 text-sm rounded-md border border-border hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmEod}
                  className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {preflight.already_run ? 'Re-run EOD' : 'Run EOD'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Result Dialog */}
      {showResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border border-border rounded-lg shadow-lg w-full max-w-md mx-4">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                {progress.status === 'completed' ? (
                  <CheckCircle size={24} className="text-success" />
                ) : (
                  <XCircle size={24} className="text-destructive" />
                )}
                <h3 className="text-lg font-semibold">
                  {progress.status === 'completed' ? 'EOD Completed' : 'EOD Failed'}
                </h3>
              </div>

              {progress.status === 'completed' ? (
                <div className="space-y-2 mb-6 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Clients Processed</span>
                    <span className="font-medium">{formatNumber(progress.clientsProcessed, 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Snapshots Created</span>
                    <span className="font-medium">{formatNumber(progress.snapshotsCreated, 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Margin Alerts</span>
                    <span className="font-medium">{formatNumber(progress.alertsGenerated, 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Batches</span>
                    <span className="font-medium">{progress.currentBatch}</span>
                  </div>
                  {progress.errors.length > 0 && (
                    <div className="mt-3 p-3 bg-destructive/10 rounded-md">
                      <p className="text-destructive text-xs font-medium mb-1">
                        {progress.errors.length} error(s) during processing:
                      </p>
                      {progress.errors.slice(0, 5).map((e, i) => (
                        <p key={i} className="text-xs text-destructive/80">{e.client_id}: {e.error}</p>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-destructive mb-6">{progress.error}</p>
              )}

              <div className="flex justify-end">
                <button
                  onClick={handleCloseResult}
                  className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PreflightRow({ label, value, status }: { label: string; value: string; status?: 'ok' | 'warn' }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-medium flex items-center gap-1 ${
        status === 'ok' ? 'text-success' : status === 'warn' ? 'text-orange-500' : ''
      }`}>
        {status === 'ok' && <CheckCircle size={14} />}
        {status === 'warn' && <AlertTriangle size={14} />}
        {value}
      </span>
    </div>
  );
}
