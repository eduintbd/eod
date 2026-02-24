import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { Client } from '@/lib/types';

export function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const PAGE_SIZE = 50;

  useEffect(() => {
    async function load() {
      setLoading(true);
      let query = supabase
        .from('clients')
        .select('*', { count: 'exact' })
        .order('client_code', { ascending: true })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (search.trim()) {
        query = query.or(
          `name.ilike.%${search}%,client_code.ilike.%${search}%,bo_id.ilike.%${search}%`
        );
      }

      const { data, count, error } = await query;
      if (error) {
        console.error('Load clients error:', error);
      }
      setClients((data as Client[]) ?? []);
      setTotalCount(count ?? 0);
      setLoading(false);
    }
    load();
  }, [search, page]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Clients</h1>
        <span className="text-sm text-muted-foreground">
          {totalCount.toLocaleString()} total clients
        </span>
      </div>

      <div className="mb-4 relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(0); }}
          placeholder="Search by name, client code, or BOID..."
          className="w-full pl-9 pr-4 py-2 border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div className="bg-card rounded-lg border border-border overflow-hidden">
        {loading ? (
          <p className="p-4 text-sm text-muted-foreground">Loading...</p>
        ) : clients.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No clients found.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground bg-muted/50">
                <th className="p-3">Code</th>
                <th className="p-3">Name</th>
                <th className="p-3">BOID</th>
                <th className="p-3">Account</th>
                <th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {clients.map(client => (
                <tr key={client.client_id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="p-3">
                    <Link
                      to={`/clients/${client.client_id}`}
                      className="text-primary font-medium hover:underline"
                    >
                      {client.client_code || '—'}
                    </Link>
                  </td>
                  <td className="p-3">{client.name || '—'}</td>
                  <td className="p-3 text-xs font-mono text-muted-foreground">
                    {client.bo_id || '—'}
                  </td>
                  <td className="p-3">{client.account_type || '—'}</td>
                  <td className="p-3">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                      client.status === 'active' ? 'bg-success/10 text-success' :
                      client.status === 'pending_review' ? 'bg-warning/10 text-warning' :
                      'bg-destructive/10 text-destructive'
                    }`}>
                      {client.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between p-3 border-t border-border text-sm">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1 bg-secondary rounded disabled:opacity-50"
            >
              Previous
            </button>
            <span className="text-muted-foreground">
              Page {page + 1} of {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="px-3 py-1 bg-secondary rounded disabled:opacity-50"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
