# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

UCB Stock CRM and Risk Management Platform — an internal system for UCB Stock Brokerage Limited (Bangladesh). The platform ingests daily financial data, maintains client positions and cash balances, enforces BSEC Margin Rules 2025, and provides dashboards for risk and relationship managers.

**Domain:** Bangladesh stock market (DSE — Dhaka Stock Exchange, CSE — Chittagong Stock Exchange). Currency is BDT. Regulatory authority is BSEC.

**Status:** Phase 1 in progress. Database schema deployed, all 4 parsers built, trade processing Edge Function deployed, frontend scaffold with routing and pages complete.

## Technology Stack

- **Database:** Supabase (PostgreSQL) with Row Level Security
- **Backend:** Supabase Edge Functions (Deno 2 / TypeScript)
- **Frontend:** React + Vite + TypeScript + Tailwind CSS (no shadcn/ui primitives yet)
- **Auth:** Supabase Auth (email/password, role-based)
- **Package Manager:** npm
- **Version Control:** GitHub

Do NOT introduce Apache Airflow, RabbitMQ, or other complex infrastructure for Phase 1.

## Supabase Projects

### Destination (working project): claudeucbstockadnan
- **Project Ref:** zuupegtizrvbnsliuddu
- **URL:** https://zuupegtizrvbnsliuddu.supabase.co
- **Schema:** public (13 tables with RLS)
- **Edge Functions:** `process-trades`, `sync-market-data`

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

Note: On this machine, Node.js requires `export PATH="/c/Program Files/nodejs:$PATH"` before running npm/npx commands.

## Sample Data Files

| File | Format | Description |
|------|--------|-------------|
| `20260201-144801-trades-UBR-out.xml` | XML | DSE trade file (~30MB, 71K+ lines). Key attributes: Action, Status, OrderID, ExecID, Side, BOID, ISIN, Quantity, Price, Value |
| `Admin Balance 31.01.2026 fixed.csv` | CSV | Client portfolio balances (~16MB, 81K+ rows). Fields: Investor Code, BOID, Instrument, Holdings, AvgCost, Market Value, Ledger Balance |
| `BT_WITH_TRADE_FLAG.txt` | Pipe-delimited | CSE trade file. Field mapping must be confirmed from this sample before building the parser |
| `Deposit Withdrawal 01.02.2026.xlsx` | Excel | Daily deposit/withdrawal transactions |

## Authoritative Specification

`UCB Stock - CRM & Risk Management Platform - Developer Instructions v1.0 (1).pdf` — this 19-page PDF is the single source of truth for all business rules, database schema, data ingestion pipeline, margin rules, fee structures, and implementation phases. Always consult it before making architectural decisions.

## Database Schema (12 tables)

All tables require `created_at` and `updated_at` timestamps. Enable RLS where appropriate.

Core tables: `clients`, `securities`, `raw_trades` (staging), `trade_executions`, `holdings`, `cash_ledger`, `margin_accounts`, `margin_alerts`, `daily_prices`, `daily_snapshots`, `fee_schedule`, `import_audit`. A `corporate_actions` table is also specified for Phase 4.

Key relationships:
- `clients.bo_id` and `clients.client_code` are both unique identifiers — map both to a single client master
- `securities.isin` is the canonical security identifier (consolidates DSE + CSE)
- `holdings` has composite PK: `(client_id, isin)`
- `cash_ledger` uses a ledger model (append-only entries, balance = running sum), NOT a single balance row

## Critical Business Rules

### Trade Processing
- **Only** Status = FILL or PF with Quantity > 0 affect positions/cash. All other statuses are informational.
- **ExecID is the deduplication key.** Never process the same ExecID twice.
- CSE trades must be normalized to the same internal structure as DSE trades.
- Holdings are consolidated per client per ISIN regardless of exchange.

### Holdings Update Logic
- **BUY:** `new_avg = (old_qty * old_avg + buy_value_with_fees) / (old_qty + buy_qty)`
- **SELL:** `realized_pl += (sell_net_value - average_cost * sell_qty)`, quantity decreases, average_cost does NOT change on sells
- Commission MUST be included in average cost calculations.

### Settlement Dates
- Category A, B, G, N: T+2 business days
- Category Z: T+3 business days (buy)
- Spot trades (CompulsorySpot=true): T+0 sell, T+1 buy

### Fee Computation (per trade)
- Brokerage Commission: negotiable, max 1% (configurable in `fee_schedule`)
- Exchange Fee (Laga): 0.03%
- CDBL Fee: 0.0175%, min BDT 5
- AIT: 0.05%
- **BUY cost** = value + commission + exchange_fee + cdbl_fee + ait
- **SELL proceeds** = value - commission - exchange_fee - cdbl_fee - ait

### Margin Rules (BSEC 2025)
Three threshold levels:
1. **NORMAL:** equity >= 75% of margin finance (portfolio >= 175% of loan)
2. **MARGIN CALL:** equity < 75% — immediate alert, notify client, track consecutive calls
3. **FORCE SELL:** equity <= 50% (portfolio <= 150% of loan) — obligated to sell immediately, no prior notice

Margin eligibility for securities: Category A on Main Board; Category B with >=5% annual dividend; Free Float Market Cap >= BDT 50 Crore; Trailing P/E <= 30 (or 2x sectoral median).

If overall market P/E > 20, all margin ratios cap at 1:0.5.

## Data Ingestion Pipeline (10 steps)

1. File Upload → 2. Parse & Stage into `raw_trades` → 3. Filter (FILL/PF only) & Validate → 4. Compute Fees → 5. Compute Settlement Date → 6. Update Holdings → 7. Update Cash Ledger → 8. Recalculate Margin → 9. Generate Alerts → 10. EOD Snapshot

Error handling: mark failed trades individually, continue batch, support re-processing.

## Implementation Phases

- **Phase 1 (Weeks 1-4):** Core data integration — Supabase setup, all parsers (Excel/XML/Text), trade processor, basic portfolio view
- **Phase 2 (Weeks 5-8):** Margin & risk engine — eligibility checks, ratio calculation, 3-level monitoring, alerts, force sell recommendations
- **Phase 3 (Weeks 9-12):** Reporting & CRM — contract notes, statements, regulatory reports, CRM features, role management
- **Phase 4 (Weeks 13+):** Corporate actions, automated price feeds, client portal, WhatsApp

Do not jump to the next phase until the current phase is fully tested and approved.

## User Roles

Admin, Risk Manager, Relationship Manager (sees only assigned clients), Operations, Viewer. Enforce via Supabase RLS policies.

## Security Constraints

- All cash/holdings changes must be audit-logged (timestamp, user, old value, new value)
- No direct deletion — use status flags and reversal transactions
- File imports must be idempotent (re-import = no duplicates)
- All business rule parameters must be configurable via admin panel without code changes
- 30-minute session timeout
