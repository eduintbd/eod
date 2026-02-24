import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { ImportAudit } from '@/lib/types';

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
            <th className="p-3 text-right">Total</th>
            <th className="p-3 text-right">Processed</th>
            <th className="p-3 text-right">Rejected</th>
            <th className="p-3">Status</th>
            <th className="p-3">Date</th>
          </tr>
        </thead>
        <tbody>
          {audits.map(a => (
            <tr key={a.id} className="border-b border-border last:border-0">
              <td className="p-3 font-medium max-w-xs truncate">{a.file_name}</td>
              <td className="p-3 text-xs">{a.file_type}</td>
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
          ))}
        </tbody>
      </table>
    </div>
  );
}
