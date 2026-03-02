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

## Sample Data Files

| File | Format | Description |
|------|--------|-------------|
| `20260201-144801-trades-UBR-out.xml` | XML | DSE trade file (~30MB, 71K+ lines) |
| `Admin Balance 31.01.2026 fixed.csv` | CSV | Client portfolio balances (~16MB, 81K+ rows) |
| `BT_WITH_TRADE_FLAG.txt` | Pipe-delimited | CSE trade file |
| `Deposit Withdrawal 01.02.2026.xlsx` | Excel | Daily deposit/withdrawal transactions |
| `historical_prices_matched(2).csv` | CSV | Historical OHLCV prices (397 rows, loaded into daily_prices) |
