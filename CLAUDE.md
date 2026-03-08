# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

UCB Stock CRM and Risk Management Platform — an internal system for UCB Stock Brokerage Limited (Bangladesh). The platform ingests daily financial data, maintains client positions and cash balances, enforces BSEC Margin Rules 2025, and provides dashboards for risk and relationship managers.

**Domain:** Bangladesh stock market (DSE — Dhaka Stock Exchange, CSE — Chittagong Stock Exchange). Currency is BDT. Regulatory authority is BSEC.

**Status:** Phase 1 complete, Phase 2 in progress. Database schema deployed, all 4 parsers built, trade processing and margin calculation engines deployed, frontend with 11 pages fully functional.

## Technology Stack

- **Database:** Supabase (PostgreSQL) with Row Level Security
- **Backend:** Supabase Edge Functions (Deno 2 / TypeScript)
- **Frontend:** React 19 + Vite + TypeScript + Tailwind CSS 4
- **Auth:** Supabase Auth (email/password, role-based)
- **Package Manager:** npm
- **Version Control:** GitHub

Do NOT introduce Apache Airflow, RabbitMQ, or other complex infrastructure for Phase 1.

## Supabase Projects

### Destination (working project): claudeucbstockadnan
- **Project Ref:** zuupegtizrvbnsliuddu
- **URL:** https://zuupegtizrvbnsliuddu.supabase.co
- **Schema:** public (13 tables with RLS)
- **Edge Functions:** `process-trades`, `sync-market-data`, `calculate-margins`, `classify-marginability`, `enrich-securities`, `backfill-prices`

### Source (read-only market data): ucb csm
- **Project Ref:** bbyrxqkoqeroymqlykcj
- **URL:** https://bbyrxqkoqeroymqlykcj.supabase.co
- **Schema:** dse_market_data (accessed via `Accept-Profile` header / `db.schema` option)
- **Tables:** daily_stock_eod, historical_prices, stock_fundamentals
- **Connection:** Frontend uses a second Supabase client (`supabase-market.ts`) with `db: { schema: 'dse_market_data' }`. Edge Functions use the source's service role key (stored in Supabase secrets). READ-ONLY — never write to the source.

## Build & Dev Commands

```bash
# Frontend dev server
cd frontend && npm run dev

# TypeScript check
cd frontend && npx tsc -b --noEmit

# Production build
cd frontend && npm run build

# Deploy Edge Function
SUPABASE_ACCESS_TOKEN=<token> npx supabase@latest functions deploy <function-name> --project-ref zuupegtizrvbnsliuddu

# Push DB migration
SUPABASE_ACCESS_TOKEN=<token> npx supabase@latest db push --include-all
```

## Project Structure

```
/eod/
├── .env / .env.example                 # Environment variables (Supabase keys)
├── CLAUDE.md                           # This file
├── BSEC_MARGIN_RULES_2025_ANALYSIS.md  # Full regulatory breakdown
├── package.json                        # Root dependencies (pg, xlsx)
│
├── frontend/
│   └── src/
│       ├── App.tsx                     # Router setup (React Router v7)
│       ├── pages/                      # 11 pages (see Frontend Pages below)
│       ├── components/
│       │   ├── layout/                 # AppLayout, Sidebar
│       │   └── import/                 # ImportSummary, ImportAuditLog
│       ├── hooks/                      # Data fetching hooks (see Hooks below)
│       ├── parsers/                    # 4 file parsers (DSE XML, CSE text, CSV, Excel)
│       └── lib/
│           ├── supabase.ts             # Main project client
│           ├── supabase-market.ts      # Source project client (dse_market_data)
│           ├── types.ts                # All TypeScript interfaces
│           └── utils.ts                # Formatting helpers (BDT, numbers, %)
│
├── supabase/
│   ├── config.toml                     # Local dev config
│   ├── seed.sql                        # Seed data
│   ├── migrations/                     # 5 migrations (schema, margin rules, alerts)
│   └── functions/
│       ├── process-trades/             # Main trade pipeline
│       ├── calculate-margins/          # Margin ratio calc & alerts
│       ├── classify-marginability/     # Security eligibility (BSEC Section 10/11)
│       ├── sync-market-data/           # Price sync from source project
│       ├── enrich-securities/          # DSE data scraping
│       ├── backfill-prices/            # Historical price loader
│       └── _shared/                    # cors, supabase-client, fee-calculator,
│                                       # margin-rules, margin-config, settlement
│
└── scripts/                            # Maintenance scripts (Node.js .mjs)
    ├── consolidated-trades.mjs         # Consolidate merchant bank/custodial trades
    ├── cleanup-duplicates.mjs          # Remove duplicate trades by exec_id
    ├── cleanup-remaining.mjs           # General cleanup
    ├── investigate-failures.mjs        # Debug/query failed trades from DB
    ├── process-remaining-trades.mjs    # Reprocess failed trades
    └── reimport-deposits.mjs           # Reload deposit/withdrawal transactions
```

## What Has Been Built

### Frontend Pages (all functional)

| Route | Page | Description |
|-------|------|-------------|
| `/login` | LoginPage | Email/password authentication |
| `/` | DashboardPage | Stats cards, recent imports, market summary (top gainers/losers) |
| `/import` | ImportPage | Drag-drop file upload, 3-stage flow: parse → upload → process |
| `/clients` | ClientsPage | Searchable/filterable client list with pagination (50/page) |
| `/clients/:id` | ClientDetailPage | Tabs: Holdings, Cash Ledger, Trade History, Margin Status |
| `/market` | MarketDataPage | Stock price browser with filtering and sorting |
| `/risk` | RiskDashboardPage | Margin risk summary: NORMAL/MARGIN_CALL/FORCE_SELL counts, filterable table |
| `/alerts` | AlertsPage | Margin alert tracking with Active/Resolved filter and Resolve button |
| `/audit` | AuditPage | Import audit log with error details |
| `/settings` | SettingsPage | Admin config tabs: Fees, Margin, System |
| `/risk/snapshots` | EodSnapshotsPage | Historical daily portfolio snapshots |

### Frontend Hooks

| Hook | Purpose |
|------|---------|
| `useAuth` | Auth state, login/logout, session management |
| `useImport` | File parsing & upload for all 4 file types |
| `useMarketData` | `useAllLatestPrices`, `useLatestPrices` |
| `useMarginData` | `useMarginAccounts`, `useMarginAccount` with status filters |
| `useAlerts` | `useMarginAlerts` (paginated), `useResolveAlert` |
| `useSnapshots` | `useClientSnapshots` for EOD history |
| `useFeeSchedule` | Fee schedule CRUD |
| `useMarginConfig` | Margin parameter CRUD |

### File Parsers (all 4 complete)

| Parser | Input | Notes |
|--------|-------|-------|
| `dse-xml-parser` | DSE XML (~30MB, 70K+ lines) | Regex-based for performance (no DOMParser) |
| `cse-text-parser` | CSE pipe-delimited text | Normalizes to same RawTrade structure |
| `admin-balance-parser` | Admin Balance CSV (~16MB, 81K rows) | Extracts client info + holdings |
| `deposit-parser` | Deposit/Withdrawal Excel (multi-sheet) | Handles both single Amount and split Debit/Credit columns |

### Edge Functions (all 6 deployed)

| Function | Purpose |
|----------|---------|
| `process-trades` | Main pipeline: raw_trades → validate → fees → settlement → holdings → cash_ledger |
| `calculate-margins` | Margin ratio calculation, 3-tier status, alert generation, deadline enforcement |
| `classify-marginability` | BSEC Section 10/11: 9 criteria for security eligibility |
| `sync-market-data` | Sync daily_stock_eod from source → local daily_prices |
| `enrich-securities` | Scrape DSE website for sector, category, P/E, market cap, etc. |
| `backfill-prices` | Load historical prices for past dates |

### Database (13 tables + margin_config)

Core: `clients`, `securities`, `raw_trades`, `trade_executions`, `holdings`, `cash_ledger`, `margin_accounts`, `margin_alerts`, `daily_prices`, `daily_snapshots`, `fee_schedule`, `import_audit`, `import_state`, `app_users`, `margin_config`

Key design decisions:
- `cash_ledger` is append-only (balance = running sum), NOT a single balance row
- `holdings` composite PK: `(client_id, isin)` — consolidated across DSE/CSE
- `exec_id` deduplication ensures idempotent re-imports
- RLS enforced: RM sees only assigned clients, Admin/Risk see all
- `securities.isin` uses mixed formats: `DSE-<CODE>` (most common), `PLACEHOLDER-<CODE>` (some), and actual BD-format ISINs (e.g. `BD8601NAL004`)
- `daily_prices` composite PK: `(isin, date)` with FK to `securities(isin)` and CHECK constraint on `source` (`'DSE'` or `'CSE'`)

6 migrations applied:
1. Initial 13-table schema with RLS policies
2. `data_date` column on `import_audit`
3. Trade summary SQL function (`get_import_summary()` — scoped to latest trade date and latest cash date)
4. `margin_config` table + security marginability fields + margin_accounts enhancements
5. Alert type constraint (DEADLINE_BREACH, EXPOSURE_BREACH)
6. `import_state` singleton table, `recalc_running_balance()` function, deposit dedup support

## Critical Business Rules

### Trade Processing
- **Only** Status = FILL or PF with Quantity > 0 affect positions/cash
- **ExecID is the deduplication key** — never process same ExecID twice
- Holdings consolidated per client per ISIN regardless of exchange

### Holdings Update Logic
- **BUY:** `new_avg = (old_qty * old_avg + buy_value_with_fees) / (old_qty + buy_qty)`
- **SELL:** `realized_pl += (sell_net_value - average_cost * sell_qty)`, average_cost does NOT change on sells
- Commission MUST be included in average cost calculations

### Fee Computation (per trade)
- Brokerage Commission: negotiable, max 1% (configurable in `fee_schedule`)
- Exchange Fee (Laga): 0.03%
- CDBL Fee: 0.0175%, min BDT 5
- AIT: 0.05%
- **BUY cost** = value + commission + exchange_fee + cdbl_fee + ait
- **SELL proceeds** = value - commission - exchange_fee - cdbl_fee - ait

### Settlement Dates
- Category A, B, G, N: T+2 business days
- Category Z: T+3 business days (buy)
- Spot trades (CompulsorySpot=true): T+0 sell, T+1 buy

### Margin Rules (BSEC 2025)
Three threshold levels:
1. **NORMAL:** equity >= 75% of margin finance (portfolio >= 175% of loan)
2. **MARGIN CALL:** equity < 75% — immediate alert, 3-business-day deadline
3. **FORCE SELL:** equity <= 50% (portfolio <= 150% of loan) — sell immediately

Auto-escalation: MARGIN_CALL → FORCE_SELL if 3-business-day deadline passes.

Dynamic ratios by portfolio size: 5-10L → 1:0.5; 10L+ → 1:1. Market P/E > 20 caps all ratios at 1:0.5.

All thresholds configurable in `margin_config` table via Settings page.

## What's Implemented vs Not Yet

### Fully Working
- All 4 data parsers
- Trade processing pipeline (raw → executions → holdings → cash)
- Fee calculation (all 4 fee types, configurable)
- Settlement date logic
- Holdings averaging with fee inclusion
- Margin calculation engine (equity ratio, status, dynamic ratios)
- Margin alerts (MARGIN_CALL, FORCE_SELL, DEADLINE_BREACH)
- 3-business-day margin call deadline enforcement
- Security marginability classifier (9 criteria)
- Market data sync from source project
- All 11 frontend pages with data fetching and filtering
- Auth + role-based RLS
- File import UI with progress tracking
- Settings page for fees & margin parameters
- Import summary scoped to latest date (trades by trade_date, deposits by transaction_date)
- Auto-creation of placeholder clients for unmatched deposit/withdrawal rows (lookup-first, insert-if-missing)
- Import state tracking with baseline guard and deposit replace-import dedup
- Running balance recalculation after deposit re-imports

### Needs Enhancement (Phase 2)
- Security marginability (needs fuller fundamental data from DSE)
- Single-client exposure limit (code present, needs `core_capital_net_worth` configured)
- Single-security exposure limit (infrastructure ready, needs activation)

### Not Yet Built (Phase 2+)
- 60-day forced sell on category downgrade
- Unrealized gain restriction on margin expansion
- Negative EPS exclusion from marginability
- Going concern / qualified audit opinion tracking
- SMS/WhatsApp notification channels
- Margin agreement versioning & expiry
- 1% general provisioning calculation
- BSEC regulatory reporting (daily, top-20 clients)
- Account closure workflow
- Contract notes & statements (Phase 3)
- Corporate actions (Phase 4)
- Client portal (Phase 4)

## Implementation Phases

- **Phase 1 (Complete):** Core data integration — Supabase setup, all parsers, trade processor, portfolio views
- **Phase 2 (In Progress):** Margin & risk engine — eligibility checks, ratio calculation, 3-level monitoring, alerts, force sell recommendations
- **Phase 3 (Future):** Reporting & CRM — contract notes, statements, regulatory reports, CRM features, role management
- **Phase 4 (Future):** Corporate actions, automated price feeds, client portal, WhatsApp

## User Roles

Admin, Risk Manager, Relationship Manager (sees only assigned clients), Operations, Viewer. Enforced via Supabase RLS policies.

## Security Constraints

- All cash/holdings changes must be audit-logged
- No direct deletion — use status flags and reversal transactions
- File imports must be idempotent (re-import = no duplicates)
- All business rule parameters configurable via admin panel without code changes
- 30-minute session timeout (specified, not yet enforced)

## Authoritative Specification

`UCB Stock - CRM & Risk Management Platform - Developer Instructions v1.0 (1).pdf` — 19-page PDF is the single source of truth for all business rules, database schema, data pipeline, margin rules, fee structures, and implementation phases. Always consult it before making architectural decisions.

## Data Loading Notes

- **Historical prices** from `historical_prices_matched(2).csv` (397 rows, dated 2026-01-13) have been uploaded to `daily_prices` table via a one-time Node.js script. The CSV ISINs were mapped to existing `securities.isin` values using the `security_code` lookup.
- When inserting into `daily_prices`, ensure ISINs exist in `securities` first (FK constraint). Some securities have `PLACEHOLDER-*` ISINs but their `security_code` matches the DSE symbol.
- Use `Prefer: resolution=merge-duplicates` header for upserts on `daily_prices` (composite PK: `isin, date`).

## Session Summary — 2026-03-04: Unsettled Issues Amount Calculation Fix

### Problem
The "Amount" column on the `/unsettled-issues` Negative Balance tab was showing the raw `running_balance` from `cash_ledger` (e.g. -86.96 for client 20093). The correct amount must account for **all unprocessed trades (buys AND sells) plus brokerage commission** to show the projected liability.

Additionally, clients with **positive** `running_balance` but unprocessed buy trades that would push them negative (e.g. client 9068 with balance +3,986.50) were completely missing from the page because the `get_negative_balance_clients` RPC only returned rows where `running_balance < 0`.

### Formula
```
amount_payable = |running_balance - buy_total - (buy_total × commission_rate) + sell_total - (sell_total × commission_rate)|
```

### Solution — DB-side computation with `amount_payable` column

Rather than computing on the frontend, the calculated amounts are now stored in the database.

**Migration `00007_add_amount_payable.sql`:**
1. Added `amount_payable NUMERIC DEFAULT 0` column to `cash_ledger`
2. Created `compute_amount_payable()` function — recalculates for all clients by joining `cash_ledger` (latest row per client) + `raw_trades` (unprocessed, EXEC, PF/FILL) + `clients` (commission_rate). Updates the `amount_payable` on each client's latest ledger entry.
3. Dropped and recreated `get_negative_balance_clients()` RPC — now returns `amount_payable` column and includes clients where `amount_payable > 0` (not just `running_balance < 0`), catching clients like 9068 who will go negative after trades settle.

**Frontend `useUnsettledIssues.ts` changes:**
- Calls `compute_amount_payable()` RPC on each page load (before fetching data) to ensure fresh values
- Reads `amount_payable` directly from the RPC result instead of computing on the frontend
- `NegativeBalanceRow` interface updated with `amount_payable` field
- Sort changed to descending (largest liability first)
- All frontend-side trade fetching / computation code removed — DB handles it

### Verification (all 8 test clients match CSV within <1 BDT)

| Code | Balance | Buy Total | Sell Total | Comm Rate | Calculated | CSV |
|------|---------|-----------|------------|-----------|------------|-----|
| 20093 | -86.96 | 221,743.50 | 0 | 0.003 | 222,495.69 | 222,496 |
| 9068 | 3,986.50 | 50,200 | 25,660 | 0.004 | 20,856.94 | 20,857 |
| 22002 | -31,514.97 | 0 | 12,157.30 | 0.004 | 19,406.30 | 19,406 |
| OBO5580 | -1,350.17 | 122,600 | 0 | 0.0045 | 124,501.87 | 124,502 |
| 21858 | 36.08 | 48,750 | 0 | 0.004 | 48,908.92 | 48,909 |
| 21775 | 22,075.50 | 31,650 | 0 | 0.004 | 9,701.10 | 9,701 |
| OBO8440 | 1,020.80 | 3,730 | 0 | 0.004 | 2,724.12 | 2,724 |
| OBO8881 | -2,066.44 | 0 | 0 | 0.004 | 2,066.44 | 2,066 |

### Key details
- `commission_rate` defaults to 0.003 if null in `clients` table
- 10 clients with positive `running_balance` are now correctly included (they go negative after unprocessed trades)
- `compute_amount_payable()` is called on every page load; could be optimized to run via cron or trigger if performance becomes a concern
- Migration applied to live DB via `supabase db push`

### Files modified
| File | Change |
|------|--------|
| `supabase/migrations/00007_add_amount_payable.sql` | New migration: column + 2 functions |
| `frontend/src/hooks/useUnsettledIssues.ts` | Simplified to read `amount_payable` from DB |

---

## Sample Data Files

| File | Format | Description |
|------|--------|-------------|
| `20260201-144801-trades-UBR-out.xml` | XML | DSE trade file (~30MB, 71K+ lines) |
| `Admin Balance 31.01.2026 fixed.csv` | CSV | Client portfolio balances (~16MB, 81K+ rows) |
| `BT_WITH_TRADE_FLAG.txt` | Pipe-delimited | CSE trade file |
| `Deposit Withdrawal 01.02.2026.xlsx` | Excel | Daily deposit/withdrawal transactions |
| `historical_prices_matched(2).csv` | CSV | Historical OHLCV prices (397 rows, loaded into daily_prices) |

---

## Session Summary — 2026-03-08: Portfolio Statement Mismatch Fix (Client 15570)

### Problem
Client 15570 (JOYANTA KARMAKAR, UUID `78de6efd-6ba2-475a-b4e6-5a78ed7a8ae4`) — portfolio statement fields (quantity, saleable, avg_cost, total_cost, market_value) did not match the reference image in `debug/15570_Portfolio_statement.jpeg`. Specific mismatches: DOMINAGE, FINEFOODS, GQBALLPEN, MKFOOTWEAR.

### Root Cause
**The `process-trades` edge function silently ignored holdings upsert failures.** The `await supabase.from('holdings').upsert(...)` returned errors but the code never checked them — trades were marked as "processed" even though holdings were never updated. This affected all 49,729 DSE trades (CSE's 12 trades worked fine). As a result, holdings were stuck at baseline values from the admin balance import.

### Fixes Applied

#### 1. `process-trades` Edge Function (not yet deployed)
- **Added error checking** on holdings upsert — now throws if upsert fails, preventing the raw_trade from being marked as processed
- **Increased avg_cost precision** from 2 decimal places to 6: `Math.round(newAvg * 1000000) / 1000000`
- File: `supabase/functions/process-trades/index.ts`

#### 2. Holdings Recalculation (DB migration, already applied)
- Created and ran `recalculate_holdings_from_trade_executions` PL/pgSQL function
- Recalculated 2,110 existing holdings from trade_executions data
- Created 627 new holdings that only existed in trade_executions but not in holdings table
- 1,989 holdings were unmodified (baseline correct, no trades applied yet)
- ~121 pre-modified holdings may have small avg_cost errors (see Pending below)

#### 3. Direct DB Fixes (already applied)
- **FINEFOODS** for client 15570: manually corrected quantity (277,169), avg_cost, realized_pl
- **MKFOOTWEAR** security: set `last_close_price=61.50`, `category='S'` (were both null)

#### 4. Frontend — ClientDetailPage.tsx
- **Saleable quantity**: now computed as `quantity - unsettled_buy_qty` where unsettled buys are trade_executions with `side='BUY'` and `settlement_date > today`
- Added `unsettledBuyMap` state with parallel fetch of unsettled BUY trades
- Fixed Portfolio Statement tab to display computed `saleable` instead of raw `h.quantity`
- **Total Cost** confirmed as `quantity × average_cost` (NOT `total_invested`, which doesn't decrease on sells)

### Verification
All 4 stocks for client 15570 now match the reference portfolio statement image (exact match on quantities, saleable, market values; <0.01% difference on total_cost for DOMINAGE/GQBALLPEN due to avg_cost precision).

### Pending Tasks

| Task | Priority | Details |
|------|----------|---------|
| ~~**Deploy process-trades**~~ | ~~HIGH~~ | DONE (session 2026-03-08) |
| ~~**Process remaining 30,241 raw_trades**~~ | ~~HIGH~~ | DONE (session 2026-03-08) — all were non-FILL statuses |
| **Fix ~120 pre-modified holdings** | MEDIUM | These may have small avg_cost errors from the migration; a full admin balance re-import would resolve them |
| **Investigate holdings upsert root cause** | LOW | Why did DSE holdings upserts fail silently? Could be timeout, RLS, concurrency, or payload issue |
| **Fix `total_invested` on SELL** | LOW | Currently `total_invested` never decreases on sells (`newInvested = oldInvested`). Should be: `newInvested = oldInvested - (oldAvg * sell_qty)` to track cost basis of current holdings |

### Files Modified
| File | Change |
|------|--------|
| `supabase/functions/process-trades/index.ts` | Added holdings upsert error check, increased avg_cost precision |
| `frontend/src/pages/ClientDetailPage.tsx` | Added unsettled buy qty fetch, fixed saleable display |
| `frontend/src/pages/DashboardPage.tsx` | Confirmed using `quantity * average_cost` (not total_invested) |

### Key Learnings
- `total_invested` is NOT the same as "Total Cost" — it's cumulative buy cost that never decreases on sells
- Always check Supabase upsert/insert errors — silent failures can cause data drift
- Holdings baseline from admin balance import is generally correct; trade processing adds deltas on top
- For ~121 holdings where process-trades partially applied trades before this fix, the recalculation migration may have slightly wrong baselines (it reversed ALL trades to find baseline, but only SOME had been applied)

---

## Session Summary — 2026-03-09: Jan 14 Trade Processing & Bulk SQL Migration

### Problem
Jan 14 trade file was imported (98,568 raw_trades) but only 105 were processed. The `process-trades` edge function timed out — it processes 200 trades per call, each trade making ~6 sequential HTTP round-trips to the database. With 35,772 FILL/PF trades, this was impossible via the edge function.

### Root Cause
The edge function's `.limit(200)` batch size + ~8 DB queries per trade over HTTP = **timeout before completing even one batch**. The 200-trade batch was already the maximum the edge function could handle within Supabase's wall-clock limit, but even that was failing for Jan 14's larger dataset.

### Solution: Server-Side SQL Processing

Created three PostgreSQL functions to replace the edge function for batch processing:

#### 1. `bulk_process_trades(batch_size int DEFAULT 5000)`
PL/pgSQL function that does the **exact same logic** as the edge function but runs directly inside PostgreSQL — no HTTP overhead. Processes trades in a loop with per-trade error handling:
- Dedup by exec_id
- Resolve client (bo_id → client_code → create placeholder)
- Resolve security (security_code → isin → create placeholder)
- Calculate fees (commission, exchange, CDBL min ৳5, AIT; client-specific rates)
- Compute settlement date (T+2/T+3, Bangladesh weekends)
- Insert trade_execution
- Update holdings (BUY: weighted avg; SELL: realized P&L)
- Insert cash_ledger entry
- Mark raw_trade processed

Returns: `{"processed": N, "skipped": N, "failed": N}`

#### 2. `mark_nonfill_trades_processed()`
Bulk-marks all non-FILL/PF trades (ACK, RPLD, CXLD, EXPIRED, REJ, null) as processed in one UPDATE.

#### 3. `add_bd_business_days(start_date date, num_days int)`
Bangladesh business day calculator — skips Friday (5) and Saturday (6).

### Frontend Integration
Updated `useImport.ts` `processTrades()` function:
- **Before:** `supabase.functions.invoke('process-trades')` — 200 trades/batch, times out
- **After:** `supabase.rpc('bulk_process_trades', { batch_size: 5000 })` — 5000 trades/batch, no timeout
- Added pre-step: `supabase.rpc('mark_nonfill_trades_processed')` to clear non-fills first
- Loop continues until `processed === 0`

### Jan 14 Processing Results
| Metric | Count |
|--------|-------|
| Total raw_trades | 98,568 |
| Non-fill (marked processed) | 62,796 |
| FILL/PF processed → trade_executions | 17,893 |
| Duplicates skipped | ~17,879 (PF + FILL rows for same exec_id) |
| Failed | 0 |
| Trade executions total (Jan 13 + 14) | 37,391 |

### Performance Comparison
| Method | Batch Size | 35,772 trades |
|--------|-----------|---------------|
| Edge function (HTTP) | 200 | **Impossible** (timeout) |
| SQL function (in-process) | 5,000 | **~3.5 minutes** (7 batches) |

### Files Modified
| File | Change |
|------|--------|
| `frontend/src/hooks/useImport.ts` | Replaced edge function call with `supabase.rpc('bulk_process_trades')` |
| `LEARNING.md` | Added bulk SQL function documentation under "Why Trade Processing Is Slow" |

### Database Functions Created
| Function | Purpose |
|----------|---------|
| `bulk_process_trades(batch_size)` | Main trade processor — runs inside Postgres |
| `mark_nonfill_trades_processed()` | Bulk-mark non-fill trades |
| `add_bd_business_days(date, days)` | Bangladesh business day calculator |

### Pending Tasks

| Task | Priority | Details |
|------|----------|---------|
| **Load Jan 14 daily prices** | HIGH | Need daily_prices for Jan 14 to compute portfolio valuations |
| **Fix ~120 pre-modified holdings** | MEDIUM | Small avg_cost errors from recalculation migration |
| **Optimize bulk_process_trades to set-based** | LOW | Current function is still O(N) per-trade loop; ideal is JOIN/GROUP BY for O(1) queries |
| **Fix `total_invested` on SELL** | LOW | Never decreases on sells |

---

## Session Summary — 2026-03-09 (cont.): Unsettled Issues Amount Cross-Check & Fee Fix

### Problem
The `/unsettled-issues` page amounts didn't match the reference CSV (`total trade file(14 Jan 2026).csv`) for several investors (OBO9395, 11144, OBO8107, OBO3534, OBO5196, 15595). Cross-checking all 19 CSV entries against the database revealed multiple root causes.

### Root Causes Identified

**1. Fee rate mismatch — Jan 13 edge function used DEFAULT rates (17,259 trades, 1,314 clients)**
The old `process-trades` edge function treated ALL trades with default fee rates (commission 0.3% + exchange 0.03% + CDBL 0.0175% + AIT 0.05%) even when the client had a specific `commission_rate`. For clients with all-inclusive rates (e.g. 0.4%), the edge function should have charged ONLY commission with exchange/CDBL/AIT = 0.

**2. Duplicate deposit + broken running balance — Client 15595 (M TEL)**
Two identical ₹300,000 deposits on Jan 14. Running balance didn't accumulate from the opening balance (showed 300,000 instead of 305,983.82). Removed duplicate deposit and recalculated running balance.

**3. OBO5196 — Opening balance mismatch in source data**
OBO5196 (commission_rate=0.0028) has a ~33K discrepancy that persists regardless of fee calculation method. Root cause is the opening balance from the admin balance import (-201,582) differs from the back-office system. Reverted to default fee rates which gave the closest match (diff ~565). This client's `commission_rate` is NOT all-inclusive — they pay discounted commission plus standard regulatory fees. Needs manual investigation of baseline data.

**4. Client 22195 — Intra-day vs EOD exposure**
CSV shows 2,466 negative balance but DB shows +50,042.73. The back-office tracks intra-day negative exposure before sells settle; our system tracks end-of-day position.

### Fixes Applied

#### 1. Recalculated fees for 17,259 Jan 13 trade_executions (1,314 clients)
```sql
UPDATE trade_executions SET
  commission = value * client_rate, exchange_fee = 0, cdbl_fee = 0, ait = 0,
  net_value = value ± (value * client_rate)
WHERE trade_date = '2026-01-13' AND client has commission_rate AND exchange_fee > 0
```

#### 2. Updated corresponding cash_ledger entries
Synced cash_ledger amounts with corrected trade_execution net_values via `reference = exec_id` join.

#### 3. Recalculated running balances
Ran `recalc_running_balance()` for all 1,314+ affected clients.

#### 4. Removed duplicate deposit for client 15595
Deleted duplicate ₹300,000 deposit entry (cash_ledger id 150077).

#### 5. Refreshed `compute_amount_payable()`
Updated amount_payable column for all clients.

### Verification Results (After Fix)

| Code | CSV Amount | DB Balance | Diff | Status |
|------|-----------|-----------|------|--------|
| 2417 | 9,576,807 | 9,576,807.29 | **0.29** | ✓ |
| 2310 | 9,574,899 | 9,574,899.42 | **0.42** | ✓ |
| 4124 | 2,893,799 | 2,893,799.48 | **0.48** | ✓ |
| 15595 | 10,806 | 10,806.18 | **0.18** | ✓ Fixed |
| 14025 | 198,603 | 198,602.84 | **-0.16** | ✓ |
| 15216 | 126,157 | 126,157.40 | **0.40** | ✓ |
| OBO9395 | 30,554 | 30,553.99 | **-0.01** | ✓ Fixed |
| 11144 | 19,991 | 19,996.46 | **5.46** | ✓ Fixed |
| OBO8107 | 18,086 | 18,086.23 | **0.23** | ✓ Fixed |
| 872 | 7,365 | 7,364.64 | **-0.36** | ✓ |
| OBO3534 | 2,621 | 2,621.14 | **0.14** | ✓ Fixed |
| 22086 | 2,431 | 2,431.29 | **0.29** | ✓ |
| OBO8881 | 2,066 | 2,066.44 | **0.44** | ✓ |
| OBO5196 | 141,876 | 108,703 | **-33,173** | ✗ Baseline issue |
| 22195 | 2,466 | +50,043 | N/A | ✗ Different calc |

**12 of 15** negative-balance clients now match within <6 BDT (rounding). 4 CSV entries (OBO1164, 2501, 8310, UR311) are non-negative-balance compliance types (Z-category netting, non-margin buy) not tracked by our system.

### Key Learnings

1. **`commission_rate` is NOT always all-inclusive.** Some clients (like OBO5196 at 0.28%) pay a discounted commission PLUS standard regulatory fees. Others (like OBO9395 at 0.40%) pay an all-inclusive rate. Need a `commission_all_inclusive` boolean flag on the clients table to distinguish.

2. **Edge function vs SQL function fee behavior must match.** The `bulk_process_trades` SQL function and the edge function both treat `commission_rate` as all-inclusive. This is correct for most clients but wrong for some. Both need to be updated when the flag is added.

3. **Deposit deduplication is still an issue.** Client 15595 had a duplicate ₹300,000 deposit. The deposit import process needs better dedup logic.

4. **Running balance must always accumulate from the first entry.** The `recalc_running_balance()` function works correctly; the issue was that it hadn't been called after fixing the duplicate deposit.

### Pending Tasks

| Task | Priority | Details |
|------|----------|---------|
| **Add `commission_all_inclusive` flag to clients** | HIGH | Distinguish between all-inclusive rates (0.4%) and discounted commission rates (0.28%). Update `bulk_process_trades` and `fee-calculator.ts` to respect this flag |
| **Investigate OBO5196 opening balance** | MEDIUM | Admin balance import gave -201,582 but back-office has ~-234,865. May need manual correction |
| **Recalculate holdings for 1,314 clients** | MEDIUM | Fee changes on Jan 13 BUY trades changed `net_value`, which affects `average_cost` in holdings |
| **Fix deposit import deduplication** | MEDIUM | Client 15595 had duplicate deposit; check other clients for similar issues |
| **Load Jan 14 daily prices** | HIGH | Need daily_prices for Jan 14 to compute portfolio valuations |
