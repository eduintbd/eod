import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, ChevronLeft, ChevronRight } from 'lucide-react';
import { useMarginAlerts, useResolveAlert } from '@/hooks/useAlerts';
import { getMarginStatusColor } from '@/lib/utils';

const FILTER_TABS = [
  { key: 'active', label: 'Active', resolved: false },
  { key: 'resolved', label: 'Resolved', resolved: true },
  { key: 'all', label: 'All', resolved: null },
] as const;

export function AlertsPage() {
  const [filterTab, setFilterTab] = useState<'active' | 'resolved' | 'all'>('active');
  const [alertType, setAlertType] = useState('');
  const [page, setPage] = useState(0);

  const resolvedFilter = FILTER_TABS.find(t => t.key === filterTab)!.resolved;
  const { alerts, totalCount, loading, error, refresh, pageSize } = useMarginAlerts({
    resolved: resolvedFilter,
    alertType: alertType || undefined,
    page,
  });
  const { resolve, resolving } = useResolveAlert();

  const totalPages = Math.ceil(totalCount / pageSize);

  async function handleResolve(alertId: number) {
    await resolve(alertId);
    refresh();
  }

  function formatDetails(details: Record<string, unknown> | null): string {
    if (!details) return '—';
    const parts: string[] = [];
    for (const [key, value] of Object.entries(details)) {
      parts.push(`${key}: ${value}`);
    }
    return parts.join(', ') || '—';
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Bell size={24} className="text-primary" />
        <h1 className="text-2xl font-bold">Margin Alerts</h1>
        <span className="ml-2 text-sm text-muted-foreground">({totalCount} total)</span>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-4 mb-4">
        <div className="flex gap-1 border-b border-border">
          {FILTER_TABS.map(t => (
            <button
              key={t.key}
              onClick={() => { setFilterTab(t.key); setPage(0); }}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-[1px] ${
                filterTab === t.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <select
          value={alertType}
          onChange={e => { setAlertType(e.target.value); setPage(0); }}
          className="px-3 py-1.5 text-sm border border-border rounded-md bg-background"
        >
          <option value="">All Types</option>
          <option value="MARGIN_CALL">Margin Call</option>
          <option value="FORCE_SELL_TRIGGERED">Force Sell</option>
          <option value="DEADLINE_BREACH">Deadline Breach</option>
          <option value="EXPOSURE_BREACH">Exposure Breach</option>
          <option value="CONCENTRATION_BREACH">Concentration Breach</option>
        </select>
      </div>

      {/* Alerts Table */}
      <div className="bg-card rounded-lg border border-border overflow-hidden">
        {error && <p className="p-4 text-sm text-destructive">Error: {error}</p>}
        {loading ? (
          <p className="p-4 text-sm text-muted-foreground">Loading alerts...</p>
        ) : alerts.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <Bell size={40} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">
              {filterTab === 'active'
                ? 'No active alerts. All margin accounts are within limits.'
                : filterTab === 'resolved'
                  ? 'No resolved alerts found.'
                  : 'No margin alerts found. Alerts will appear after EOD processing.'}
            </p>
          </div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground bg-muted/50">
                  <th className="p-3">Date</th>
                  <th className="p-3">Client</th>
                  <th className="p-3">Alert Type</th>
                  <th className="p-3">Details</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map(a => (
                  <tr key={a.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="p-3 text-xs">{a.alert_date}</td>
                    <td className="p-3">
                      <Link to={`/clients/${a.client_id}`} className="text-primary hover:underline font-medium">
                        {a.client?.client_code ?? a.client?.name ?? a.client_id}
                      </Link>
                    </td>
                    <td className="p-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${getMarginStatusColor(a.alert_type)}`}>
                        {a.alert_type.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="p-3 text-xs text-muted-foreground max-w-[300px] truncate">
                      {formatDetails(a.details)}
                    </td>
                    <td className="p-3">
                      {a.resolved ? (
                        <span className="text-xs text-muted-foreground">Resolved {a.resolved_date ?? ''}</span>
                      ) : (
                        <span className="text-xs text-warning font-medium">Active</span>
                      )}
                    </td>
                    <td className="p-3">
                      {!a.resolved && (
                        <button
                          onClick={() => handleResolve(a.id)}
                          disabled={resolving}
                          className="px-2 py-1 text-xs rounded bg-success/10 text-success hover:bg-success/20 transition-colors disabled:opacity-50"
                        >
                          Resolve
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between p-3 border-t border-border">
                <span className="text-xs text-muted-foreground">
                  Page {page + 1} of {totalPages}
                </span>
                <div className="flex gap-1">
                  <button
                    onClick={() => setPage(p => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="p-1 rounded hover:bg-muted disabled:opacity-30"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                    className="p-1 rounded hover:bg-muted disabled:opacity-30"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
