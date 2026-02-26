import { useState, useCallback, useEffect, type DragEvent } from 'react';
import { Upload, FileText, AlertCircle, CheckCircle2, Loader2, Info, AlertTriangle } from 'lucide-react';
import { useImport, type FileType, getImportState, validateDailyImportDate } from '@/hooks/useImport';
import { ImportAuditLog } from '@/components/import/ImportAuditLog';
import { ImportSummary } from '@/components/import/ImportSummary';
import { ReconciliationResults } from '@/components/import/ReconciliationResults';
import type { ImportState } from '@/lib/types';

export function ImportPage() {
  const { progress, importFile, processTrades, reset, lastAuditId } = useImport();
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileType, setFileType] = useState<FileType | ''>('');
  const [asOfDate, setAsOfDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [importState, setImportState] = useState<ImportState | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [validationWarning, setValidationWarning] = useState<string | null>(null);

  // Load import state on mount and after imports complete
  const refreshImportState = useCallback(async () => {
    const state = await getImportState();
    setImportState(state);
  }, []);

  useEffect(() => { refreshImportState(); }, [refreshImportState]);
  useEffect(() => {
    if (progress.stage === 'done' || progress.stage === 'reconciliation') {
      refreshImportState();
    }
  }, [progress.stage, refreshImportState]);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      setSelectedFile(file);
      autoDetectType(file);
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      autoDetectType(file);
    }
  }, []);

  const autoDetectType = (file: File) => {
    const name = file.name.toLowerCase();
    if (name.endsWith('.xml')) setFileType('DSE_TRADE');
    else if (name.endsWith('.txt')) setFileType('CSE_TRADE');
    else if (name.endsWith('.csv')) setFileType('ADMIN_BALANCE');
    else if (name.endsWith('.xlsx') || name.endsWith('.xls')) setFileType('DEPOSIT_WITHDRAWAL');
    else setFileType('');
  };

  const handleUpload = async () => {
    if (!selectedFile || !fileType) return;
    setValidationError(null);
    setValidationWarning(null);

    // Validate daily imports (trades, deposits) against baseline
    const ft = fileType as FileType;
    if (ft !== 'ADMIN_BALANCE') {
      const validation = await validateDailyImportDate(ft, asOfDate);
      if (!validation.ok) {
        setValidationError(validation.error!);
        return;
      }
      if (validation.warning) {
        setValidationWarning(validation.warning);
      }
    }

    await importFile(selectedFile, ft, asOfDate);
  };

  const handleProcessTrades = async () => {
    await processTrades(lastAuditId ?? undefined);
  };

  const handleReset = () => {
    reset();
    setSelectedFile(null);
    setFileType('');
    setValidationError(null);
    setValidationWarning(null);
  };

  const isIdle = progress.stage === 'idle';
  const isDone = progress.stage === 'done';
  const isError = progress.stage === 'error';
  const isReconciliation = progress.stage === 'reconciliation';
  const isWorking = ['parsing', 'uploading', 'processing'].includes(progress.stage);

  // Compute next expected date (simple +1 day, skipping nothing — user handles weekends/holidays)
  const nextExpectedDate = importState?.last_processed_date
    ? (() => {
        const d = new Date(importState.last_processed_date + 'T00:00:00');
        d.setDate(d.getDate() + 1);
        return d.toISOString().slice(0, 10);
      })()
    : null;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Import Data</h1>

      {/* Import State Bar */}
      <div className="mb-4 px-4 py-3 rounded-lg border border-border bg-card text-sm">
        {importState?.baseline_date ? (
          <div className="flex flex-wrap gap-x-6 gap-y-1 items-center">
            <span>
              <span className="text-muted-foreground">Baseline:</span>{' '}
              <span className="font-medium">{importState.baseline_date}</span>
            </span>
            <span>
              <span className="text-muted-foreground">Last Processed:</span>{' '}
              <span className="font-medium">{importState.last_processed_date ?? '—'}</span>
            </span>
            {nextExpectedDate && (
              <span>
                <span className="text-muted-foreground">Next Expected:</span>{' '}
                <span className="font-medium">{nextExpectedDate}</span>
              </span>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Info size={16} />
            No baseline imported yet. Import an Admin Balance CSV to start.
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Upload Zone */}
        <div className="bg-card rounded-lg border border-border p-6">
          <h2 className="font-semibold mb-4">Upload File</h2>

          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              dragOver ? 'border-primary bg-primary/5' : 'border-border'
            }`}
          >
            <Upload size={32} className="mx-auto mb-3 text-muted-foreground" />
            <p className="text-sm text-muted-foreground mb-2">
              Drag and drop a file here, or click to browse
            </p>
            <input
              type="file"
              accept=".xml,.csv,.txt,.xlsx,.xls"
              onChange={handleFileSelect}
              className="hidden"
              id="file-input"
            />
            <label
              htmlFor="file-input"
              className="inline-block px-4 py-2 bg-secondary text-secondary-foreground rounded-md text-sm cursor-pointer hover:bg-secondary/80"
            >
              Choose File
            </label>
          </div>

          {selectedFile && (
            <div className="mt-4 space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <FileText size={16} />
                <span className="font-medium">{selectedFile.name}</span>
                <span className="text-muted-foreground">
                  ({(selectedFile.size / 1024 / 1024).toFixed(1)} MB)
                </span>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">File Type</label>
                <select
                  value={fileType}
                  onChange={e => setFileType(e.target.value as FileType)}
                  className="w-full px-3 py-2 border border-input rounded-md text-sm"
                >
                  <option value="">Select type...</option>
                  <option value="ADMIN_BALANCE">Admin Balance (CSV)</option>
                  <option value="DSE_TRADE">DSE Trades (XML)</option>
                  <option value="CSE_TRADE">CSE Trades (Text)</option>
                  <option value="DEPOSIT_WITHDRAWAL">Deposit/Withdrawal (Excel)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Data Date (As-of Date)</label>
                <input
                  type="date"
                  value={asOfDate}
                  onChange={e => setAsOfDate(e.target.value)}
                  className="w-full px-3 py-2 border border-input rounded-md text-sm"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  The date this data represents (e.g. balance date, transaction date)
                </p>
              </div>

              {/* Validation messages */}
              {validationError && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-destructive/10 text-destructive text-sm">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  <span>{validationError}</span>
                </div>
              )}
              {validationWarning && !validationError && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 text-sm">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                  <span>{validationWarning}</span>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={handleUpload}
                  disabled={!fileType || isWorking}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
                >
                  {isWorking ? 'Processing...' : 'Upload & Parse'}
                </button>
                {(isDone || isError || isReconciliation) && (
                  <button
                    onClick={handleReset}
                    className="px-4 py-2 bg-secondary text-secondary-foreground rounded-md text-sm"
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Progress / Status */}
        <div className="bg-card rounded-lg border border-border p-6">
          <h2 className="font-semibold mb-4">Import Status</h2>

          {isIdle && (
            <p className="text-sm text-muted-foreground">Select a file to begin.</p>
          )}

          {isWorking && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-info">
                <Loader2 size={16} className="animate-spin" />
                <span className="capitalize">{progress.stage}...</span>
              </div>
              {progress.message && (
                <p className="text-xs text-muted-foreground">{progress.message}</p>
              )}
              {progress.totalRows > 0 && (
                <>
                  <div className="w-full bg-muted rounded-full h-2">
                    <div
                      className="bg-info h-2 rounded-full transition-all"
                      style={{ width: `${Math.min(100, (progress.uploadedRows / progress.totalRows) * 100)}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {progress.uploadedRows.toLocaleString()} / {progress.totalRows.toLocaleString()} rows
                  </p>
                </>
              )}
            </div>
          )}

          {isDone && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-success">
                <CheckCircle2 size={16} />
                Import complete
              </div>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="bg-muted rounded p-2">
                  <p className="text-lg font-semibold">{progress.totalRows.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">Total Rows</p>
                </div>
                <div className="bg-success/10 rounded p-2">
                  <p className="text-lg font-semibold text-success">{progress.processedRows.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">Processed</p>
                </div>
                <div className="bg-destructive/10 rounded p-2">
                  <p className="text-lg font-semibold text-destructive">{progress.rejectedRows.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">Rejected</p>
                </div>
              </div>

              {(fileType === 'DSE_TRADE' || fileType === 'CSE_TRADE') && (
                <button
                  onClick={handleProcessTrades}
                  className="w-full mt-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90"
                >
                  Process Trades (compute fees, update holdings & cash)
                </button>
              )}
            </div>
          )}

          {isReconciliation && progress.reconciliationResult && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-blue-600">
                <Info size={16} />
                Reconciliation complete — baseline already exists, data was compared (not imported)
              </div>
              <div className="grid grid-cols-2 gap-3 text-center">
                <div className="bg-success/10 rounded p-2">
                  <p className="text-lg font-semibold text-success">
                    {progress.reconciliationResult.matchedHoldings + progress.reconciliationResult.matchedCash}
                  </p>
                  <p className="text-xs text-muted-foreground">Matched</p>
                </div>
                <div className="bg-destructive/10 rounded p-2">
                  <p className="text-lg font-semibold text-destructive">
                    {progress.reconciliationResult.holdingMismatches.length + progress.reconciliationResult.cashMismatches.length}
                  </p>
                  <p className="text-xs text-muted-foreground">Mismatches</p>
                </div>
              </div>
            </div>
          )}

          {isError && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle size={16} />
                Import failed
              </div>
              <p className="text-sm text-muted-foreground">{progress.errorMessage}</p>
            </div>
          )}
        </div>
      </div>

      {/* Reconciliation Results (shown when admin balance compared against existing baseline) */}
      {isReconciliation && progress.reconciliationResult && (
        <div className="mb-8">
          <ReconciliationResults result={progress.reconciliationResult} />
        </div>
      )}

      {/* Data Summary */}
      <div className="mb-8">
        <ImportSummary />
      </div>

      {/* Audit Log */}
      <ImportAuditLog />
    </div>
  );
}
