import { useEffect, useState, Fragment } from 'react';
import { supabase } from '@/lib/supabase';
import type { ImportAudit } from '@/lib/types';

const fmtN = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
const fmtM = (n: number) => {
  if (Math.abs(n) >= 1e7) return (n / 1e7).toFixed(2) + ' Cr';
  if (Math.abs(n) >= 1e5) return (n / 1e5).toFixed(2) + ' L';
  return n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
};

function DepositSummary({ s }: { s: Record<string, number> }) {
  return (
    <span>
      Deposits: {fmtN(s.deposit_count)} (+{fmtM(s.deposit_total)})
      {' | '}Withdrawals: {fmtN(s.withdrawal_count)} (-{fmtM(s.withdrawal_total)})
      {' | '}Net: {s.net_deposit >= 0 ? '+' : ''}{fmtM(s.net_deposit)}
    </span>
  );
}

function TradeSummary({ s }: { s: Record<string, number> }) {
  const parts: string[] = [];
  if (s.dse_buy_count > 0 || s.dse_sell_count > 0) {
    parts.push(`DSE Buy: ${fmtN(s.dse_buy_count)} (${fmtM(s.dse_buy_value)})`);
    parts.push(`DSE Sell: ${fmtN(s.dse_sell_count)} (${fmtM(s.dse_sell_value)})`);
  }
  if (s.cse_buy_count > 0 || s.cse_sell_count > 0) {
    parts.push(`CSE Buy: ${fmtN(s.cse_buy_count)} (${fmtM(s.cse_buy_value)})`);
    parts.push(`CSE Sell: ${fmtN(s.cse_sell_count)} (${fmtM(s.cse_sell_value)})`);
  }
  if (s.total_turnover > 0) {
    parts.push(`Turnover: ${fmtM(s.total_turnover)}`);
  }
  return <span>{parts.join(' | ')}</span>;
}

function ProcessingSummary({ s }: { s: Record<string, unknown> }) {
  const commission = Number(s.total_commission) || 0;
  const fees = Number(s.total_fees) || 0;
  const pct = Number(s.commission_pct) || 0;
  const maxPct = Number(s.max_allowed_pct) || 2;
  return (
    <span>
      Commission: {fmtM(commission)} ({pct.toFixed(4)}% of {maxPct}% max)
      {' | '}Fees: {fmtM(fees)}
      {' | '}Executions: {fmtN(Number(s.total_executions) || 0)}
    </span>
  );
}

function SummaryRow({ details }: { details: Record<string, unknown> | null }) {
  if (!details) return null;

  const summary = details.summary as Record<string, number> | undefined;
  const processing = details.processing_summary as Record<string, unknown> | undefined;
  if (!summary && !processing) return null;

  // Determine type from summary shape
  const isDeposit = summary && 'deposit_count' in summary;
  const isTrade = summary && 'dse_buy_count' in summary;

  return (
    <tr>
      <td colSpan={8} className="px-3 pb-2 pt-0 text-xs text-muted-foreground bg-muted/30">
        {isDeposit && <DepositSummary s={summary!} />}
        {isTrade && <TradeSummary s={summary!} />}
        {isTrade && processing && <span>{' | '}</span>}
        {processing && <ProcessingSummary s={processing} />}
      </td>
    </tr>
  );
}

export function ImportAuditLog() {
  const [audits, setAudits] = useState<ImportAudit[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAudits();
  }, []);

  async function loadAudits() {
    setLoading(true);
    const { data, error } = await supabase
      .from('import_audit')
      .select('*')
      .order('import_date', { ascending: false })
      .limit(50);

    if (error) console.error('Load audits error:', error);
    setAudits((data as ImportAudit[]) ?? []);
    setLoading(false);
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading audit log...</p>;

  if (audits.length === 0) {
    return (
      <div className="bg-card rounded-lg border border-border p-4">
        <p className="text-sm text-muted-foreground">No imports recorded yet.</p>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-lg border border-border overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground bg-muted/50">
            <th className="p-3">File Name</th>
            <th className="p-3">Type</th>
            <th className="p-3">Data Date</th>
            <th className="p-3 text-right">Total</th>
            <th className="p-3 text-right">Processed</th>
            <th className="p-3 text-right">Rejected</th>
            <th className="p-3">Status</th>
            <th className="p-3">Imported At</th>
          </tr>
        </thead>
        <tbody>
          {audits.map(a => (
            <Fragment key={a.id}>
              <tr className="border-b border-border last:border-0">
                <td className="p-3 font-medium max-w-xs truncate">{a.file_name}</td>
                <td className="p-3 text-xs">{a.file_type}</td>
                <td className="p-3 text-xs font-medium">
                  {a.data_date
                    ? new Date(a.data_date + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                    : '-'}
                </td>
                <td className="p-3 text-right">{a.total_rows.toLocaleString()}</td>
                <td className="p-3 text-right text-success">{a.processed_rows.toLocaleString()}</td>
                <td className="p-3 text-right text-destructive">{a.rejected_rows.toLocaleString()}</td>
                <td className="p-3">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                    a.status === 'SUCCESS' ? 'bg-success/10 text-success' :
                    a.status === 'FAILED' ? 'bg-destructive/10 text-destructive' :
                    a.status === 'PROCESSING' ? 'bg-info/10 text-info' :
                    'bg-warning/10 text-warning'
                  }`}>
                    {a.status}
                  </span>
                </td>
                <td className="p-3 text-muted-foreground text-xs">
                  {new Date(a.import_date).toLocaleString()}
                </td>
              </tr>
              <SummaryRow details={a.error_details} />
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
