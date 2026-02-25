import { useState } from 'react';
import { Settings, Plus, Pencil, X, Check } from 'lucide-react';
import { useFeeSchedule, useUpdateFee } from '@/hooks/useFeeSchedule';
import { useMarginConfig, useUpdateMarginConfig } from '@/hooks/useMarginConfig';
import { formatNumber } from '@/lib/utils';
import type { FeeScheduleEntry } from '@/lib/types';

const SETTINGS_TABS = ['fees', 'margin', 'system'] as const;

interface EditingFee {
  id: number | null; // null = new entry
  fee_type: string;
  rate: string;
  min_amount: string;
  max_amount: string;
  applies_to: string;
  effective_from: string;
  effective_to: string;
  is_active: boolean;
}

function emptyFee(): EditingFee {
  return {
    id: null,
    fee_type: '',
    rate: '',
    min_amount: '',
    max_amount: '',
    applies_to: 'ALL',
    effective_from: new Date().toISOString().slice(0, 10),
    effective_to: '',
    is_active: true,
  };
}

export function SettingsPage() {
  const [tab, setTab] = useState<'fees' | 'margin' | 'system'>('fees');
  const { fees, loading, error, refresh } = useFeeSchedule();
  const { updateFee, addFee, saving } = useUpdateFee();
  const [editing, setEditing] = useState<EditingFee | null>(null);

  // Margin config state
  const { configs: marginConfigs, loading: marginLoading, error: marginError, refresh: marginRefresh } = useMarginConfig();
  const { updateConfig, saving: marginSaving } = useUpdateMarginConfig();
  const [editingConfig, setEditingConfig] = useState<{ id: number; value: string } | null>(null);

  function startEdit(fee: FeeScheduleEntry) {
    setEditing({
      id: fee.id,
      fee_type: fee.fee_type,
      rate: String(fee.rate),
      min_amount: fee.min_amount != null ? String(fee.min_amount) : '',
      max_amount: fee.max_amount != null ? String(fee.max_amount) : '',
      applies_to: fee.applies_to ?? 'ALL',
      effective_from: fee.effective_from,
      effective_to: fee.effective_to ?? '',
      is_active: fee.is_active,
    });
  }

  async function handleSave() {
    if (!editing) return;
    try {
      const payload = {
        fee_type: editing.fee_type,
        rate: parseFloat(editing.rate) || 0,
        min_amount: editing.min_amount ? parseFloat(editing.min_amount) : null,
        max_amount: editing.max_amount ? parseFloat(editing.max_amount) : null,
        applies_to: editing.applies_to || null,
        effective_from: editing.effective_from,
        effective_to: editing.effective_to || null,
        is_active: editing.is_active,
      };

      if (editing.id != null) {
        await updateFee(editing.id, payload);
      } else {
        await addFee(payload);
      }
      setEditing(null);
      refresh();
    } catch {
      // error shown by hook
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Settings size={24} className="text-primary" />
        <h1 className="text-2xl font-bold">Settings</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-border">
        {SETTINGS_TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-[1px] ${
              tab === t
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t === 'fees' ? 'Fee Schedule' : t === 'margin' ? 'Margin Config' : 'System'}
          </button>
        ))}
      </div>

      {tab === 'fees' && (
        <div>
          <div className="flex justify-end mb-3">
            <button
              onClick={() => setEditing(emptyFee())}
              disabled={editing !== null}
              className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              <Plus size={14} /> Add Fee
            </button>
          </div>

          <div className="bg-card rounded-lg border border-border overflow-hidden">
            {error && <p className="p-4 text-sm text-destructive">Error: {error}</p>}
            {loading ? (
              <p className="p-4 text-sm text-muted-foreground">Loading fee schedule...</p>
            ) : fees.length === 0 && !editing ? (
              <div className="p-8 text-center text-muted-foreground">
                <Settings size={40} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm">No fee schedule entries. Click "Add Fee" to create one.</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground bg-muted/50">
                    <th className="p-3">Fee Type</th>
                    <th className="p-3 text-right">Rate (%)</th>
                    <th className="p-3 text-right">Min Amount</th>
                    <th className="p-3 text-right">Max Amount</th>
                    <th className="p-3">Applies To</th>
                    <th className="p-3">Effective From</th>
                    <th className="p-3">Effective To</th>
                    <th className="p-3">Active</th>
                    <th className="p-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {/* New entry row */}
                  {editing && editing.id === null && (
                    <tr className="border-b border-border bg-primary/5">
                      <td className="p-2">
                        <input value={editing.fee_type} onChange={e => setEditing({ ...editing, fee_type: e.target.value })}
                          className="w-full px-2 py-1 text-sm border border-border rounded bg-background" placeholder="e.g. COMMISSION" />
                      </td>
                      <td className="p-2">
                        <input value={editing.rate} onChange={e => setEditing({ ...editing, rate: e.target.value })}
                          className="w-20 px-2 py-1 text-sm border border-border rounded bg-background text-right" placeholder="0.00" />
                      </td>
                      <td className="p-2">
                        <input value={editing.min_amount} onChange={e => setEditing({ ...editing, min_amount: e.target.value })}
                          className="w-20 px-2 py-1 text-sm border border-border rounded bg-background text-right" placeholder="—" />
                      </td>
                      <td className="p-2">
                        <input value={editing.max_amount} onChange={e => setEditing({ ...editing, max_amount: e.target.value })}
                          className="w-20 px-2 py-1 text-sm border border-border rounded bg-background text-right" placeholder="—" />
                      </td>
                      <td className="p-2">
                        <input value={editing.applies_to} onChange={e => setEditing({ ...editing, applies_to: e.target.value })}
                          className="w-20 px-2 py-1 text-sm border border-border rounded bg-background" placeholder="ALL" />
                      </td>
                      <td className="p-2">
                        <input type="date" value={editing.effective_from} onChange={e => setEditing({ ...editing, effective_from: e.target.value })}
                          className="px-2 py-1 text-sm border border-border rounded bg-background" />
                      </td>
                      <td className="p-2">
                        <input type="date" value={editing.effective_to} onChange={e => setEditing({ ...editing, effective_to: e.target.value })}
                          className="px-2 py-1 text-sm border border-border rounded bg-background" />
                      </td>
                      <td className="p-2 text-center">
                        <input type="checkbox" checked={editing.is_active} onChange={e => setEditing({ ...editing, is_active: e.target.checked })} />
                      </td>
                      <td className="p-2">
                        <div className="flex gap-1">
                          <button onClick={handleSave} disabled={saving || !editing.fee_type}
                            className="p-1 rounded text-success hover:bg-success/10 disabled:opacity-50"><Check size={16} /></button>
                          <button onClick={() => setEditing(null)}
                            className="p-1 rounded text-destructive hover:bg-destructive/10"><X size={16} /></button>
                        </div>
                      </td>
                    </tr>
                  )}

                  {fees.map(fee => {
                    const isEditing = editing?.id === fee.id;
                    if (isEditing && editing) {
                      return (
                        <tr key={fee.id} className="border-b border-border last:border-0 bg-primary/5">
                          <td className="p-2">
                            <input value={editing.fee_type} onChange={e => setEditing({ ...editing, fee_type: e.target.value })}
                              className="w-full px-2 py-1 text-sm border border-border rounded bg-background" />
                          </td>
                          <td className="p-2">
                            <input value={editing.rate} onChange={e => setEditing({ ...editing, rate: e.target.value })}
                              className="w-20 px-2 py-1 text-sm border border-border rounded bg-background text-right" />
                          </td>
                          <td className="p-2">
                            <input value={editing.min_amount} onChange={e => setEditing({ ...editing, min_amount: e.target.value })}
                              className="w-20 px-2 py-1 text-sm border border-border rounded bg-background text-right" />
                          </td>
                          <td className="p-2">
                            <input value={editing.max_amount} onChange={e => setEditing({ ...editing, max_amount: e.target.value })}
                              className="w-20 px-2 py-1 text-sm border border-border rounded bg-background text-right" />
                          </td>
                          <td className="p-2">
                            <input value={editing.applies_to} onChange={e => setEditing({ ...editing, applies_to: e.target.value })}
                              className="w-20 px-2 py-1 text-sm border border-border rounded bg-background" />
                          </td>
                          <td className="p-2">
                            <input type="date" value={editing.effective_from} onChange={e => setEditing({ ...editing, effective_from: e.target.value })}
                              className="px-2 py-1 text-sm border border-border rounded bg-background" />
                          </td>
                          <td className="p-2">
                            <input type="date" value={editing.effective_to} onChange={e => setEditing({ ...editing, effective_to: e.target.value })}
                              className="px-2 py-1 text-sm border border-border rounded bg-background" />
                          </td>
                          <td className="p-2 text-center">
                            <input type="checkbox" checked={editing.is_active} onChange={e => setEditing({ ...editing, is_active: e.target.checked })} />
                          </td>
                          <td className="p-2">
                            <div className="flex gap-1">
                              <button onClick={handleSave} disabled={saving}
                                className="p-1 rounded text-success hover:bg-success/10 disabled:opacity-50"><Check size={16} /></button>
                              <button onClick={() => setEditing(null)}
                                className="p-1 rounded text-destructive hover:bg-destructive/10"><X size={16} /></button>
                            </div>
                          </td>
                        </tr>
                      );
                    }

                    return (
                      <tr key={fee.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                        <td className="p-3 font-medium">{fee.fee_type}</td>
                        <td className="p-3 text-right">{formatNumber(fee.rate, 4)}</td>
                        <td className="p-3 text-right">{fee.min_amount != null ? formatNumber(fee.min_amount) : '—'}</td>
                        <td className="p-3 text-right">{fee.max_amount != null ? formatNumber(fee.max_amount) : '—'}</td>
                        <td className="p-3">{fee.applies_to ?? 'ALL'}</td>
                        <td className="p-3 text-xs">{fee.effective_from}</td>
                        <td className="p-3 text-xs">{fee.effective_to ?? '—'}</td>
                        <td className="p-3">
                          <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                            fee.is_active ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'
                          }`}>
                            {fee.is_active ? 'Yes' : 'No'}
                          </span>
                        </td>
                        <td className="p-3">
                          <button
                            onClick={() => startEdit(fee)}
                            disabled={editing !== null}
                            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30"
                          >
                            <Pencil size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === 'margin' && (
        <div>
          <p className="text-sm text-muted-foreground mb-3">
            BSEC Margin Rules 2025 parameters. Changes take effect on the next margin calculation run.
          </p>
          <div className="bg-card rounded-lg border border-border overflow-hidden">
            {marginError && <p className="p-4 text-sm text-destructive">Error: {marginError}</p>}
            {marginLoading ? (
              <p className="p-4 text-sm text-muted-foreground">Loading margin config...</p>
            ) : marginConfigs.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <Settings size={40} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm">No margin config parameters found. Run migration 00004 first.</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground bg-muted/50">
                    <th className="p-3">Parameter</th>
                    <th className="p-3">Description</th>
                    <th className="p-3 text-right">Value</th>
                    <th className="p-3">Active</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {marginConfigs.map(cfg => {
                    const isEditing = editingConfig?.id === cfg.id;
                    return (
                      <tr key={cfg.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                        <td className="p-3 font-medium font-mono text-xs">{cfg.parameter_name}</td>
                        <td className="p-3 text-xs text-muted-foreground">{cfg.description ?? '—'}</td>
                        <td className="p-3 text-right">
                          {isEditing ? (
                            <input
                              value={editingConfig.value}
                              onChange={e => setEditingConfig({ ...editingConfig, value: e.target.value })}
                              className="w-28 px-2 py-1 text-sm border border-border rounded bg-background text-right"
                              autoFocus
                            />
                          ) : (
                            <span className="font-mono">{formatNumber(cfg.parameter_value, 4)}</span>
                          )}
                        </td>
                        <td className="p-3">
                          <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                            cfg.is_active ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'
                          }`}>
                            {cfg.is_active ? 'Yes' : 'No'}
                          </span>
                        </td>
                        <td className="p-3 text-right">
                          {isEditing ? (
                            <div className="flex gap-1 justify-end">
                              <button
                                onClick={async () => {
                                  try {
                                    await updateConfig(cfg.id, { parameter_value: parseFloat(editingConfig.value) || 0 });
                                    setEditingConfig(null);
                                    marginRefresh();
                                  } catch { /* error shown by hook */ }
                                }}
                                disabled={marginSaving}
                                className="p-1 rounded text-success hover:bg-success/10 disabled:opacity-50"
                              >
                                <Check size={16} />
                              </button>
                              <button onClick={() => setEditingConfig(null)} className="p-1 rounded text-destructive hover:bg-destructive/10">
                                <X size={16} />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setEditingConfig({ id: cfg.id, value: String(cfg.parameter_value) })}
                              disabled={editingConfig !== null}
                              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30"
                            >
                              <Pencil size={14} />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === 'system' && (
        <div className="bg-card rounded-lg border border-border p-8 text-center text-muted-foreground">
          <Settings size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">System configuration options will be available in Phase 3.</p>
        </div>
      )}
    </div>
  );
}
