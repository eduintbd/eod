import type { ReconciliationResult } from '@/lib/types';

const fmt = new Intl.NumberFormat('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function ReconciliationResults({ result }: { result: ReconciliationResult }) {
  const { holdingMismatches, cashMismatches, matchedHoldings, matchedCash } = result;
  const totalMismatches = holdingMismatches.length + cashMismatches.length;

  return (
    <div className="space-y-6">
      <div className="bg-card rounded-lg border border-border p-4">
        <h3 className="font-semibold mb-3">Reconciliation Summary</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center text-sm">
          <div className="bg-muted rounded p-2">
            <p className="text-lg font-semibold">{matchedHoldings}</p>
            <p className="text-xs text-muted-foreground">Holdings Matched</p>
          </div>
          <div className="bg-muted rounded p-2">
            <p className="text-lg font-semibold">{matchedCash}</p>
            <p className="text-xs text-muted-foreground">Cash Matched</p>
          </div>
          <div className={`rounded p-2 ${holdingMismatches.length > 0 ? 'bg-destructive/10' : 'bg-muted'}`}>
            <p className={`text-lg font-semibold ${holdingMismatches.length > 0 ? 'text-destructive' : ''}`}>
              {holdingMismatches.length}
            </p>
            <p className="text-xs text-muted-foreground">Holding Mismatches</p>
          </div>
          <div className={`rounded p-2 ${cashMismatches.length > 0 ? 'bg-destructive/10' : 'bg-muted'}`}>
            <p className={`text-lg font-semibold ${cashMismatches.length > 0 ? 'text-destructive' : ''}`}>
              {cashMismatches.length}
            </p>
            <p className="text-xs text-muted-foreground">Cash Mismatches</p>
          </div>
        </div>
      </div>

      {totalMismatches === 0 && (
        <p className="text-sm text-success text-center">All holdings and cash balances match perfectly.</p>
      )}

      {/* Holdings Mismatches */}
      {holdingMismatches.length > 0 && (
        <div className="bg-card rounded-lg border border-border p-4">
          <h3 className="font-semibold mb-3">Holdings Mismatches ({holdingMismatches.length})</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="pb-2 pr-3">Client</th>
                  <th className="pb-2 pr-3">Security</th>
                  <th className="pb-2 pr-3 text-right">File Qty</th>
                  <th className="pb-2 pr-3 text-right">DB Qty</th>
                  <th className="pb-2 pr-3 text-right">Diff</th>
                  <th className="pb-2 pr-3 text-right">File Avg Cost</th>
                  <th className="pb-2 pr-3 text-right">DB Avg Cost</th>
                  <th className="pb-2 text-right">Cost Diff</th>
                </tr>
              </thead>
              <tbody>
                {holdingMismatches.slice(0, 100).map((m, i) => (
                  <tr key={i} className="border-b border-border/50">
                    <td className="py-1.5 pr-3">
                      <span className="font-mono text-xs">{m.bo_id}</span>
                      {m.client_name && <span className="text-muted-foreground ml-1">({m.client_name})</span>}
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-xs">{m.security_code}</td>
                    <td className="py-1.5 pr-3 text-right">{m.file_qty.toLocaleString()}</td>
                    <td className="py-1.5 pr-3 text-right">{m.db_qty.toLocaleString()}</td>
                    <td className={`py-1.5 pr-3 text-right font-medium ${m.diff_qty !== 0 ? 'text-destructive' : ''}`}>
                      {m.diff_qty > 0 ? '+' : ''}{m.diff_qty.toLocaleString()}
                    </td>
                    <td className="py-1.5 pr-3 text-right">{fmt.format(m.file_avg_cost)}</td>
                    <td className="py-1.5 pr-3 text-right">{fmt.format(m.db_avg_cost)}</td>
                    <td className={`py-1.5 text-right font-medium ${Math.abs(m.diff_avg_cost) > 0.01 ? 'text-destructive' : ''}`}>
                      {m.diff_avg_cost > 0 ? '+' : ''}{fmt.format(m.diff_avg_cost)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {holdingMismatches.length > 100 && (
              <p className="text-xs text-muted-foreground mt-2">
                Showing first 100 of {holdingMismatches.length} mismatches.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Cash Mismatches */}
      {cashMismatches.length > 0 && (
        <div className="bg-card rounded-lg border border-border p-4">
          <h3 className="font-semibold mb-3">Cash Balance Mismatches ({cashMismatches.length})</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="pb-2 pr-3">Client</th>
                  <th className="pb-2 pr-3 text-right">File Balance</th>
                  <th className="pb-2 pr-3 text-right">DB Balance</th>
                  <th className="pb-2 text-right">Diff</th>
                </tr>
              </thead>
              <tbody>
                {cashMismatches.slice(0, 100).map((m, i) => (
                  <tr key={i} className="border-b border-border/50">
                    <td className="py-1.5 pr-3">
                      <span className="font-mono text-xs">{m.bo_id}</span>
                      {m.client_name && <span className="text-muted-foreground ml-1">({m.client_name})</span>}
                    </td>
                    <td className="py-1.5 pr-3 text-right">{fmt.format(m.file_balance)}</td>
                    <td className="py-1.5 pr-3 text-right">{fmt.format(m.db_balance)}</td>
                    <td className={`py-1.5 text-right font-medium ${Math.abs(m.diff) > 0.01 ? 'text-destructive' : ''}`}>
                      {m.diff > 0 ? '+' : ''}{fmt.format(m.diff)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {cashMismatches.length > 100 && (
              <p className="text-xs text-muted-foreground mt-2">
                Showing first 100 of {cashMismatches.length} mismatches.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
