import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Download, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { useUnsettledIssues } from '@/hooks/useUnsettledIssues';
import type { UnsettledFilters, UnsettledIssue } from '@/hooks/useUnsettledIssues';
import { useNegativeEquity, useFilteredNegativeEquity } from '@/hooks/useNegativeEquity';
import type { NegativeEquityAccount, NegativeEquityFilters } from '@/hooks/useNegativeEquity';
import { formatBDT, getMarginStatusColor } from '@/lib/utils';
import * as XLSX from 'xlsx';

const PAGE_SIZE = 25;

type Tab = 'equity' | 'balance';

const TABS: { key: Tab; label: string }[] = [
  { key: 'equity', label: 'Negative Equity' },
  { key: 'balance', label: 'Negative Balance' },
];

// ── Excel export helpers ──────────────────────────────────────────────

function exportEquityExcel(accounts: NegativeEquityAccount[]) {
  const rows = accounts.map((a, idx) => ({
    'SL': idx + 1,
    'Code': a.clientCode,
    'Client Name': a.clientName,
    'Acct Type': a.accountType,
    'Portfolio Value': a.totalPortfolioValue,
    'Loan Balance': a.loanBalance,
    'Equity': a.clientEquity,
    'Provision': a.provisionAmount,
    'Status': a.maintenanceStatus,
    'Applied Ratio': a.appliedRatio,
    'Margin Calls': a.marginCallCount,
    'Deadline': a.deadline || '',
    'Department': a.department,
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 4 },  { wch: 10 }, { wch: 28 }, { wch: 8 },
    { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 },
    { wch: 14 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 15 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Negative Equity');
  const today = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `Negative_Equity_${today}.xlsx`);
}

function exportBalanceExcel(issues: UnsettledIssue[]) {
  const rows = issues.map((i, idx) => ({
    'SL': idx + 1,
    'Event Date': i.eventDate,
    'Code': i.clientCode,
    'Client Name': i.clientName,
    'Acct Type': i.accountType,
    'Instruments': i.instruments,
    'Amount (BDT)': i.amount,
    'Loan Ratio': i.loanRatio,
    'RM Name': i.rmName,
    'Type of Non Compliance': i.nonComplianceType,
    'Remarks': i.remarks,
    'Head of Department': i.hodName,
    'Department': i.department,
    'RM Frequency': i.rmFrequency,
    'Unsettled Days': i.unsettledDays,
    'Disciplinary Measure': i.disciplinaryMeasure,
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 4 },  { wch: 12 }, { wch: 10 }, { wch: 25 }, { wch: 8 },
    { wch: 12 }, { wch: 15 }, { wch: 12 }, { wch: 20 },
    { wch: 28 }, { wch: 15 }, { wch: 20 }, { wch: 15 },
    { wch: 10 }, { wch: 12 }, { wch: 35 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Negative Balance');
  const today = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `Negative_Balance_${today}.xlsx`);
}

// ── Main page ─────────────────────────────────────────────────────────

export function UnsettledIssuesPage() {
  const [activeTab, setActiveTab] = useState<Tab>('equity');
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');

  // Shared filters
  const [accountType, setAccountType] = useState('');
  const [department, setDepartment] = useState('');

  // Balance-specific filters
  const [rmName, setRmName] = useState('');
  const [nonComplianceType, setNonComplianceType] = useState('');

  // ── Negative Equity data ──
  const {
    accounts: eqAccounts,
    filterOptions: eqFilterOptions,
    loading: eqLoading,
    error: eqError,
  } = useNegativeEquity();

  const eqFilters: NegativeEquityFilters = {
    accountType: accountType || undefined,
    department: department || undefined,
  };
  const { filtered: eqFiltered, summary: eqSummary } = useFilteredNegativeEquity(eqAccounts, eqFilters);

  const eqSearched = search.trim()
    ? eqFiltered.filter(a =>
        a.clientCode.toLowerCase().includes(search.toLowerCase()) ||
        a.clientName.toLowerCase().includes(search.toLowerCase())
      )
    : eqFiltered;

  // ── Negative Balance data ──
  const balFilters: UnsettledFilters = {
    department: department || undefined,
    rmName: rmName || undefined,
    nonComplianceType: nonComplianceType || undefined,
    accountType: accountType || undefined,
  };
  const {
    issues: balFiltered,
    summary: balSummary,
    filterOptions: balFilterOptions,
    loading: balLoading,
    error: balError,
  } = useUnsettledIssues(balFilters);

  const balSearched = search.trim()
    ? balFiltered.filter(i =>
        i.clientCode.toLowerCase().includes(search.toLowerCase()) ||
        i.clientName.toLowerCase().includes(search.toLowerCase()) ||
        i.instruments.toLowerCase().includes(search.toLowerCase())
      )
    : balFiltered;

  // ── Pagination ──
  const currentList = activeTab === 'equity' ? eqSearched : balSearched;
  const totalPages = Math.ceil(currentList.length / PAGE_SIZE);
  const paged = currentList.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const loading = activeTab === 'equity' ? eqLoading : balLoading;
  const error = activeTab === 'equity' ? eqError : balError;

  // Merge department options from both data sources
  const allDepartments = [...new Set([
    ...eqFilterOptions.departments,
    ...balFilterOptions.departments,
  ])].sort();

  const allAccountTypes = [...new Set([
    ...eqFilterOptions.accountTypes,
    ...balFilterOptions.accountTypes,
  ])].sort();

  function handleTabChange(tab: Tab) {
    setActiveTab(tab);
    setPage(0);
    // Reset tab-specific filters
    setRmName('');
    setNonComplianceType('');
  }

  function handleExport() {
    if (activeTab === 'equity') {
      exportEquityExcel(eqSearched);
    } else {
      exportBalanceExcel(balSearched);
    }
  }

  function clearFilters() {
    setAccountType('');
    setDepartment('');
    setRmName('');
    setNonComplianceType('');
    setSearch('');
    setPage(0);
  }

  const hasFilters = accountType || department || rmName || nonComplianceType || search;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <AlertTriangle size={24} className="text-warning" />
          <h1 className="text-2xl font-bold">Unsettled Issues</h1>
          <span className="ml-2 text-sm text-muted-foreground">
            ({currentList.length} accounts)
          </span>
        </div>
        <button
          onClick={handleExport}
          disabled={currentList.length === 0}
          className="flex items-center gap-2 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          <Download size={16} />
          Export Excel
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border mb-6">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => handleTabChange(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-[1px] ${
              activeTab === t.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Summary Cards */}
      {!loading && !error && activeTab === 'equity' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-card border border-border rounded-lg p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Accounts</p>
            <p className="text-2xl font-bold mt-1">{eqSummary.totalAccounts}</p>
          </div>
          <div className="bg-card border border-border rounded-lg p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Provision Required</p>
            <p className="text-2xl font-bold mt-1 text-destructive">{formatBDT(eqSummary.totalProvision)}</p>
          </div>
          <div className="bg-card border border-border rounded-lg p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">By Status</p>
            <div className="mt-1 space-y-0.5">
              {Object.entries(eqSummary.byStatus).map(([status, count]) => (
                <p key={status} className="text-sm">
                  <span className="font-medium">{count}</span>{' '}
                  <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${getMarginStatusColor(status)}`}>
                    {status.replace(/_/g, ' ')}
                  </span>
                </p>
              ))}
              {Object.keys(eqSummary.byStatus).length === 0 && (
                <p className="text-sm text-muted-foreground">None</p>
              )}
            </div>
          </div>
          <div className="bg-card border border-border rounded-lg p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">By Account Type</p>
            <div className="mt-1 space-y-0.5">
              {Object.entries(eqSummary.byAccountType).map(([type, count]) => (
                <p key={type} className="text-sm">
                  <span className="font-medium">{count}</span>{' '}
                  <span className="text-muted-foreground">{type}</span>
                  {type === 'Cash' && <span className="ml-1 text-xs text-orange-500 font-medium">Suspense</span>}
                </p>
              ))}
              {Object.keys(eqSummary.byAccountType).length === 0 && (
                <p className="text-sm text-muted-foreground">None</p>
              )}
            </div>
          </div>
        </div>
      )}

      {!loading && !error && activeTab === 'balance' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-card border border-border rounded-lg p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Accounts</p>
            <p className="text-2xl font-bold mt-1">{balSummary.totalAccounts}</p>
          </div>
          <div className="bg-card border border-border rounded-lg p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Negative Amount</p>
            <p className="text-2xl font-bold mt-1 text-destructive">{formatBDT(balSummary.totalNegativeAmount)}</p>
          </div>
          <div className="bg-card border border-border rounded-lg p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">By Type</p>
            <div className="mt-1 space-y-0.5">
              {Object.entries(balSummary.byType).map(([type, count]) => (
                <p key={type} className="text-sm">
                  <span className="font-medium">{count}</span>{' '}
                  <span className="text-muted-foreground">{type}</span>
                </p>
              ))}
              {Object.keys(balSummary.byType).length === 0 && (
                <p className="text-sm text-muted-foreground">None</p>
              )}
            </div>
          </div>
          <div className="bg-card border border-border rounded-lg p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Unique RMs Involved</p>
            <p className="text-2xl font-bold mt-1">{balSummary.uniqueRMs}</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0); }}
            placeholder="Search code, name..."
            className="pl-8 pr-3 py-1.5 text-sm border border-border rounded-md bg-background w-56 focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <select
          value={accountType}
          onChange={e => { setAccountType(e.target.value); setPage(0); }}
          className="px-3 py-1.5 text-sm border border-border rounded-md bg-background"
        >
          <option value="">All Account Types</option>
          {allAccountTypes.map(t => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select
          value={department}
          onChange={e => { setDepartment(e.target.value); setPage(0); }}
          className="px-3 py-1.5 text-sm border border-border rounded-md bg-background"
        >
          <option value="">All Departments</option>
          {allDepartments.map(d => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>

        {/* Balance-tab-specific filters */}
        {activeTab === 'balance' && (
          <>
            <select
              value={rmName}
              onChange={e => { setRmName(e.target.value); setPage(0); }}
              className="px-3 py-1.5 text-sm border border-border rounded-md bg-background"
            >
              <option value="">All RMs</option>
              {balFilterOptions.rmNames.map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <select
              value={nonComplianceType}
              onChange={e => { setNonComplianceType(e.target.value); setPage(0); }}
              className="px-3 py-1.5 text-sm border border-border rounded-md bg-background"
            >
              <option value="">All Types</option>
              {balFilterOptions.nonComplianceTypes.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </>
        )}

        {hasFilters && (
          <button
            onClick={clearFilters}
            className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-card rounded-lg border border-border overflow-hidden">
        {error && <p className="p-4 text-sm text-destructive">Error: {error}</p>}
        {loading ? (
          <p className="p-4 text-sm text-muted-foreground">
            {activeTab === 'equity' ? 'Loading negative equity accounts...' : 'Loading unsettled issues...'}
          </p>
        ) : currentList.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <AlertTriangle size={40} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">
              {activeTab === 'equity'
                ? hasFilters
                  ? 'No accounts match the current filters.'
                  : 'No negative equity accounts found. All clients have positive equity.'
                : hasFilters
                  ? 'No issues match the current filters.'
                  : 'No unsettled issues found. All client balances are non-negative.'
              }
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              {activeTab === 'equity' ? (
                <EquityTable
                  accounts={paged as NegativeEquityAccount[]}
                  startIndex={page * PAGE_SIZE}
                />
              ) : (
                <BalanceTable
                  issues={paged as UnsettledIssue[]}
                  startIndex={page * PAGE_SIZE}
                />
              )}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between p-3 border-t border-border">
                <span className="text-xs text-muted-foreground">
                  Page {page + 1} of {totalPages} ({currentList.length} accounts)
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

// ── Equity table ──────────────────────────────────────────────────────

function EquityTable({ accounts, startIndex }: { accounts: NegativeEquityAccount[]; startIndex: number }) {
  return (
    <table className="w-full text-sm whitespace-nowrap">
      <thead>
        <tr className="border-b border-border text-left text-muted-foreground bg-muted/50">
          <th className="p-3 text-xs">#</th>
          <th className="p-3 text-xs">Code</th>
          <th className="p-3 text-xs">Client Name</th>
          <th className="p-3 text-xs">Acct Type</th>
          <th className="p-3 text-xs text-right">Portfolio Value</th>
          <th className="p-3 text-xs text-right">Loan Balance</th>
          <th className="p-3 text-xs text-right">Equity</th>
          <th className="p-3 text-xs text-right">Provision</th>
          <th className="p-3 text-xs">Status</th>
          <th className="p-3 text-xs">Department</th>
        </tr>
      </thead>
      <tbody>
        {accounts.map((a, idx) => (
          <tr key={a.clientId} className="border-b border-border last:border-0 hover:bg-muted/30">
            <td className="p-3 text-xs text-muted-foreground">{startIndex + idx + 1}</td>
            <td className="p-3">
              <Link
                to={`/clients/${a.clientId}`}
                className="text-primary font-medium hover:underline"
              >
                {a.clientCode}
              </Link>
            </td>
            <td className="p-3 max-w-[200px] truncate" title={a.clientName}>
              {a.clientName}
            </td>
            <td className="p-3 text-xs">
              {a.accountType}
              {a.accountType === 'Cash' && (
                <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-orange-500/10 text-orange-500">
                  Suspense
                </span>
              )}
            </td>
            <td className="p-3 text-right font-mono text-xs">
              {formatBDT(a.totalPortfolioValue)}
            </td>
            <td className="p-3 text-right font-mono text-xs">
              {formatBDT(a.loanBalance)}
            </td>
            <td className="p-3 text-right font-mono text-destructive font-medium">
              {formatBDT(a.clientEquity)}
            </td>
            <td className="p-3 text-right font-mono text-destructive font-medium">
              {formatBDT(a.provisionAmount)}
            </td>
            <td className="p-3">
              <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${getMarginStatusColor(a.maintenanceStatus)}`}>
                {a.maintenanceStatus.replace(/_/g, ' ')}
              </span>
            </td>
            <td className="p-3 text-xs">{a.department}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Balance table (existing view) ─────────────────────────────────────

function BalanceTable({ issues, startIndex }: { issues: UnsettledIssue[]; startIndex: number }) {
  return (
    <table className="w-full text-sm whitespace-nowrap">
      <thead>
        <tr className="border-b border-border text-left text-muted-foreground bg-muted/50">
          <th className="p-3 text-xs">#</th>
          <th className="p-3 text-xs">Event Date</th>
          <th className="p-3 text-xs">Code</th>
          <th className="p-3 text-xs">Client Name</th>
          <th className="p-3 text-xs">Acct Type</th>
          <th className="p-3 text-xs">Instruments</th>
          <th className="p-3 text-xs text-right">Amount (BDT)</th>
          <th className="p-3 text-xs">Loan Ratio</th>
          <th className="p-3 text-xs">RM</th>
          <th className="p-3 text-xs">Non-Compliance Type</th>
          <th className="p-3 text-xs">Department</th>
          <th className="p-3 text-xs text-center">RM Freq</th>
          <th className="p-3 text-xs text-center">Days</th>
          <th className="p-3 text-xs">Disciplinary Measure</th>
        </tr>
      </thead>
      <tbody>
        {issues.map((issue, idx) => (
          <tr key={issue.clientId} className="border-b border-border last:border-0 hover:bg-muted/30">
            <td className="p-3 text-xs text-muted-foreground">{startIndex + idx + 1}</td>
            <td className="p-3 text-xs">{issue.eventDate}</td>
            <td className="p-3">
              <Link
                to={`/clients/${issue.clientId}`}
                className="text-primary font-medium hover:underline"
              >
                {issue.clientCode}
              </Link>
            </td>
            <td className="p-3 max-w-[200px] truncate" title={issue.clientName}>
              {issue.clientName}
            </td>
            <td className="p-3 text-xs">{issue.accountType}</td>
            <td className="p-3 text-xs font-mono">{issue.instruments}</td>
            <td className="p-3 text-right font-mono text-destructive font-medium">
              {formatBDT(issue.amount)}
            </td>
            <td className="p-3 text-xs">{issue.loanRatio}</td>
            <td className="p-3 text-xs max-w-[150px] truncate" title={issue.rmName}>
              {issue.rmName}
            </td>
            <td className="p-3">
              <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                issue.nonComplianceType === 'Negative Balance-OMS Trade'
                  ? 'bg-destructive/10 text-destructive'
                  : issue.nonComplianceType === 'Negative Balance'
                    ? 'bg-warning/10 text-warning'
                    : 'bg-orange-500/10 text-orange-500'
              }`}>
                {issue.nonComplianceType}
              </span>
            </td>
            <td className="p-3 text-xs">{issue.department}</td>
            <td className="p-3 text-center">
              <span className={`inline-block min-w-[24px] px-1.5 py-0.5 rounded text-xs font-bold ${
                issue.rmFrequency >= 4
                  ? 'bg-destructive/10 text-destructive'
                  : issue.rmFrequency >= 3
                    ? 'bg-orange-500/10 text-orange-500'
                    : issue.rmFrequency >= 2
                      ? 'bg-warning/10 text-warning'
                      : 'bg-muted text-muted-foreground'
              }`}>
                {issue.rmFrequency}
              </span>
            </td>
            <td className="p-3 text-center">
              <span className={`inline-block min-w-[28px] px-1.5 py-0.5 rounded text-xs font-bold ${
                issue.unsettledDays >= 7
                  ? 'bg-destructive/10 text-destructive'
                  : issue.unsettledDays >= 3
                    ? 'bg-warning/10 text-warning'
                    : 'bg-muted text-muted-foreground'
              }`}>
                {issue.unsettledDays}
              </span>
            </td>
            <td className="p-3 text-xs max-w-[250px] truncate" title={issue.disciplinaryMeasure}>
              {issue.disciplinaryMeasure}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
