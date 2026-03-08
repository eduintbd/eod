# LEARNING: Why Trade Processing Is Slow & How to Fix It

## The Problem

Processing 19,500 trades took an estimated **1.5+ hours** using the `process-trades` edge function (and even the optimized local script). This document explains the root cause, the optimizations applied, and the ideal architecture.

---

## 0. The Architecture Flaw That Caused the N+1 Problem

The root flaw is a **misplaced separation of concerns**. The system was designed with this layered architecture:

```
┌─────────────────────────────────┐
│  Frontend (React)               │  ← User uploads trade file
│  Parses file → raw_trades rows  │
└──────────────┬──────────────────┘
               │ HTTP POST (with raw rows)
               ▼
┌─────────────────────────────────┐
│  Edge Function (Deno/TypeScript)│  ← "Application layer"
│  FOR EACH trade:                │     Resolves references,
│    resolve client (query)       │     computes fees,
│    resolve security (query)     │     updates positions,
│    compute fees (in-memory)     │     writes cash ledger
│    insert execution (query)     │
│    read holding (query)         │     ALL business logic lives
│    upsert holding (query)       │     HERE, in a for-loop
│    read last balance (query)    │
│    insert ledger (query)        │
│    mark processed (query)       │
└──────────────┬──────────────────┘
               │ 8 queries × N trades
               ▼
┌─────────────────────────────────┐
│  PostgreSQL (Supabase)          │  ← "Dumb storage"
│  Just stores/retrieves rows     │     No business logic
│  via REST API (PostgREST)       │     No aggregation
└─────────────────────────────────┘
```

### The Flaw: Treating PostgreSQL as a Dumb Key-Value Store

The edge function treats the database as if it were Redis or a simple key-value store — fetch one row, modify it in application code, write it back. But PostgreSQL is a **relational database engine** designed for exactly this kind of work. It has:

- **JOINs** — resolve client and security references for ALL trades in one pass
- **GROUP BY + aggregate functions** — compute net position changes per client/security in one query
- **ON CONFLICT DO UPDATE** — atomically upsert holdings without read-then-write
- **Window functions** — compute running balances across ordered rows without a loop
- **CTEs (WITH clauses)** — chain multiple operations into a single atomic statement

None of these capabilities were used. Instead, the application layer reimplemented what SQL does natively — but over a network, one row at a time.

### Why This Happened

This is a common pattern when developers come from a **web application background** where the architecture is:

```
API receives request → fetch data from DB → transform in app code → write back to DB
```

This works perfectly for **single-entity operations** (e.g., "update this user's profile", "place this one order"). The overhead of 3-5 queries per request is negligible when you handle one request at a time.

But **batch processing is a fundamentally different problem**. When the same 3-5 queries-per-item pattern is applied to 19,500 items, the cost multiplies linearly:

| Scenario | Queries | Network time at 30ms each |
|---|---|---|
| 1 trade (API request) | 8 | 240ms — perfectly fine |
| 100 trades (small import) | 800 | 24 seconds — tolerable |
| 19,500 trades (daily batch) | 156,000 | **78 minutes — broken** |

The architecture wasn't wrong for single trades. It was wrong for **batch operations that were shoehorned into the same single-trade code path**.

### The Correct Separation of Concerns

The fix isn't adding more application-layer tricks (parallelism, caching). Those are band-aids. The fix is **moving batch logic to where it belongs**:

```
┌─────────────────────────────────┐
│  Frontend / Edge Function       │  ← Orchestrator only
│  Triggers: "process batch X"    │     One RPC call
└──────────────┬──────────────────┘
               │ 1 RPC call
               ▼
┌─────────────────────────────────┐
│  PostgreSQL Stored Procedure    │  ← ALL batch logic here
│                                 │
│  INSERT INTO trade_executions   │     JOINs resolve references
│    SELECT ... FROM raw_trades   │     in bulk (1 query)
│    JOIN clients ON ...          │
│    JOIN securities ON ...;      │     GROUP BY aggregates
│                                 │     positions (1 query)
│  INSERT INTO holdings           │
│    SELECT client_id, isin,      │     Window functions compute
│      SUM(qty_delta)             │     running balances (1 query)
│    GROUP BY client_id, isin     │
│    ON CONFLICT DO UPDATE;       │     Total: 4-6 queries
│                                 │     regardless of trade count
│  INSERT INTO cash_ledger ...;   │
│  UPDATE raw_trades SET          │
│    processed = true;            │
└─────────────────────────────────┘
```

The key insight: **the number of queries should scale with the number of STEPS in the pipeline, not the number of TRADES**. Whether you have 100 trades or 100,000 trades, the pipeline has the same 4-6 steps. Each step processes all trades at once using SQL's set-based operations.

### Analogy

Imagine you need to mail 19,500 letters. The N+1 approach is:

```
FOR each letter:
  Drive to post office        (network round-trip)
  Hand over 1 letter          (single INSERT)
  Drive home                  (response)
  Repeat 19,499 more times
```

The set-based approach is:

```
Load all 19,500 letters into a truck   (bulk fetch)
Drive to post office once              (1 round-trip)
Hand over the entire truck             (bulk INSERT)
Drive home once                        (1 response)
```

Same result. 1 trip instead of 19,500. That's the difference between 78 minutes and 10 seconds.

---

## 1. Root Cause Analysis: The N+1 Query Problem

### What Happens Per Trade

The `process-trades` function (both edge function and local script) processes each trade **one at a time** in a `for` loop. For every single trade, it makes **8+ sequential database round-trips**:

```
For each of 19,500 trades:
  1. SELECT client by bo_id          → 1 query
  2. SELECT client by client_code    → 1 query (if #1 fails)
  3. SELECT security by code         → 1 query
  4. SELECT security by isin         → 1 query (if #3 fails)
  5. INSERT trade_execution          → 1 query
  6. SELECT current holding          → 1 query
  7. UPSERT holding                  → 1 query
  8. SELECT last cash_ledger balance → 1 query
  9. INSERT cash_ledger entry        → 1 query
  10. UPDATE raw_trades (processed)  → 1 query
```

**Total queries: 19,500 trades × ~8 queries = 156,000 database round-trips**

### The Math of Why It's Slow

Each database round-trip over the network has latency:
- **Supabase REST API** (used by our script): ~20-50ms per request (HTTP overhead + TLS + JSON serialization)
- **Direct PostgreSQL connection**: ~1-5ms per query (TCP, no HTTP)

With REST API at ~30ms average:
```
156,000 queries × 30ms = 4,680 seconds ≈ 78 minutes
```

With direct PostgreSQL at ~3ms average:
```
156,000 queries × 3ms = 468 seconds ≈ 8 minutes
```

Even with a direct database connection, the N+1 pattern makes sub-minute processing impossible for 19,500 trades.

### Why the Edge Function Times Out

Supabase Edge Functions have strict limits:
| Constraint | Free Tier | Pro Tier |
|---|---|---|
| Wall clock time | 150 seconds | 400 seconds |
| CPU time | 2 seconds | 2 seconds |

Processing 200 trades at ~30ms/query × 8 queries = **48 seconds per batch**. But the function was consistently timing out at **~2.5 minutes (504 Gateway Timeout)** because:
1. Some queries take longer (cold cache, index misses)
2. INSERT operations are slower than SELECTs (WAL writes, index updates)
3. Supabase's gateway has its own timeout before the function's limit

---

## 2. Optimizations Applied (Current State)

### A. Local Script Instead of Edge Function

**Problem:** Edge function has 150-400 second timeout.
**Solution:** Run processing locally with `scripts/process-trades-local.mjs` — no timeout limit.

This eliminated the timeout issue but didn't address the fundamental N+1 problem.

### B. Parallel Processing (10 concurrent trades)

**Problem:** Sequential processing = 1 trade at a time.
**Solution:** Process 10 trades simultaneously using `Promise.allSettled()`.

```javascript
const CONCURRENCY = 10;
for (let i = 0; i < rawTrades.length; i += CONCURRENCY) {
  const chunk = rawTrades.slice(i, i + CONCURRENCY);
  await Promise.allSettled(chunk.map(raw => processSingleTrade(raw, ...)));
}
```

**Result:** Throughput went from **~20 trades/min → ~200 trades/min** (10x improvement).

### C. In-Memory Caching for Lookups

**Problem:** Same client looked up hundreds of times (e.g., client "1169" has 500+ trades).
**Solution:** Cache `clientId` and `isin` resolutions in a `Map`.

```javascript
const clientCache = new Map();  // bo_id/client_code → client_id
const securityCache = new Map(); // security_code → isin
```

**Result:** Eliminated ~60-70% of lookup queries (most clients and securities repeat).

### Net Effect

| Metric | Edge Function | Local Sequential | Local Parallel+Cached |
|---|---|---|---|
| Batch size | 200 | 20 | 100 |
| Concurrency | 1 | 1 | 10 |
| Speed | Timeout (504) | ~20/min | ~200/min |
| Time for 19,500 | Impossible | ~16 hours | ~1.5 hours |

**Still too slow.** 1.5 hours for 19,500 trades is unacceptable. The problem is architectural, not just optimization.

---

## 3. The Ideal Architecture: Set-Based Processing

The fundamental insight from financial system design: **process trades as a SET, not as individual items.**

### What "Set-Based" Means

Instead of:
```
FOR each trade:
  lookup client      → 1 query
  lookup security    → 1 query
  insert execution   → 1 query
  update holdings    → 1 query
  update cash        → 1 query
= 19,500 × 5 = 97,500 queries
```

Do:
```
1. Bulk INSERT all 19,500 trade_executions → 1 query (using UNNEST arrays)
2. Bulk UPDATE all holdings               → 1 query (using aggregate + ON CONFLICT)
3. Bulk INSERT all cash_ledger entries     → 1 query (using aggregate)
4. Bulk UPDATE raw_trades as processed    → 1 query
= 4 queries total
```

### Architecture Option A: PostgreSQL Stored Procedure (Best for Supabase)

Move ALL processing logic into a single PostgreSQL stored procedure. No application code, no network round-trips.

```sql
CREATE OR REPLACE PROCEDURE process_trade_batch(p_batch_size INT DEFAULT 5000)
LANGUAGE plpgsql
AS $$
DECLARE
  v_chunk_offset INT := 0;
  v_rows_affected INT;
BEGIN
  LOOP
    -- Step 1: Resolve clients + securities with JOINs (not per-row lookups)
    -- Step 2: Bulk INSERT into trade_executions using INSERT...SELECT
    -- Step 3: Compute position deltas with GROUP BY
    -- Step 4: Bulk UPSERT holdings
    -- Step 5: Compute cash ledger entries
    -- Step 6: Bulk INSERT cash_ledger with running_balance via window function
    -- Step 7: Mark raw_trades as processed
    -- All in one chunked transaction

    WITH chunk AS (
      SELECT rt.*,
             c.client_id,
             COALESCE(s1.isin, s2.isin) AS resolved_isin
      FROM raw_trades rt
      LEFT JOIN clients c ON c.bo_id = rt.bo_id OR c.client_code = rt.client_code
      LEFT JOIN securities s1 ON s1.security_code = rt.security_code
      LEFT JOIN securities s2 ON s2.isin = rt.isin
      WHERE rt.processed = false
        AND rt.status IN ('FILL', 'PF')
        AND rt.quantity > 0
      ORDER BY rt.id
      LIMIT p_batch_size
      OFFSET v_chunk_offset
    ),
    -- Insert executions
    inserted_execs AS (
      INSERT INTO trade_executions (exec_id, client_id, isin, side, quantity, price, ...)
      SELECT exec_id, client_id, resolved_isin, ...
      FROM chunk
      WHERE exec_id NOT IN (SELECT exec_id FROM trade_executions)
      ON CONFLICT (exec_id) DO NOTHING
      RETURNING *
    ),
    -- Aggregate holdings changes
    holding_deltas AS (
      SELECT client_id, isin,
             SUM(CASE WHEN side='BUY' THEN quantity ELSE -quantity END) AS qty_delta,
             SUM(CASE WHEN side='BUY' THEN net_value ELSE 0 END) AS buy_value
      FROM inserted_execs
      GROUP BY client_id, isin
    )
    -- Update holdings in one shot
    INSERT INTO holdings (client_id, isin, quantity, ...)
    SELECT client_id, isin, qty_delta, ...
    FROM holding_deltas
    ON CONFLICT (client_id, isin) DO UPDATE SET
      quantity = holdings.quantity + EXCLUDED.quantity,
      ...;

    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

    -- Mark as processed
    UPDATE raw_trades SET processed = true
    WHERE id IN (SELECT id FROM chunk);

    COMMIT;  -- Intermediate commit (only works in PROCEDURE, not FUNCTION)

    EXIT WHEN v_rows_affected = 0;
    v_chunk_offset := v_chunk_offset + p_batch_size;
  END LOOP;
END;
$$;
```

**Expected performance:** 19,500 trades in **5-15 seconds**.

Why? Because:
- JOINs replace per-row lookups (1 query instead of 19,500)
- GROUP BY replaces per-row aggregation
- ON CONFLICT replaces read-then-write patterns
- Everything runs inside PostgreSQL — zero network round-trips
- Chunked COMMIT every 5,000 rows prevents lock contention

### Architecture Option B: UNNEST Bulk Operations from Node.js

If you need to keep logic in application code (easier to debug/modify):

```javascript
// 1. Fetch ALL unprocessed trades in one query
const { data: trades } = await supabase.from('raw_trades')
  .select('*').eq('processed', false).in('status', ['FILL', 'PF']).gt('quantity', 0);

// 2. Bulk-resolve all clients in ONE query
const boIds = [...new Set(trades.map(t => t.bo_id).filter(Boolean))];
const { data: clients } = await supabase.from('clients')
  .select('client_id, bo_id, client_code').in('bo_id', boIds);
const clientMap = new Map(clients.map(c => [c.bo_id, c.client_id]));

// 3. Bulk-resolve all securities in ONE query
const codes = [...new Set(trades.map(t => t.security_code).filter(Boolean))];
const { data: secs } = await supabase.from('securities')
  .select('isin, security_code').in('security_code', codes);
const secMap = new Map(secs.map(s => [s.security_code, s.isin]));

// 4. Prepare all trade_executions in memory, bulk INSERT via UNNEST
// 5. Compute all holding deltas in memory, bulk UPSERT
// 6. Compute all cash ledger entries in memory, bulk INSERT
// = ~6 queries total instead of 156,000
```

**Expected performance:** 19,500 trades in **30-60 seconds** (limited by Supabase REST API overhead for large payloads).

### Architecture Option C: PostgreSQL COPY + Staging Table

The fastest possible approach for raw ingestion:

```
1. COPY staged_trades FROM STDIN (CSV)     → load all 19,500 rows in <1 second
2. INSERT INTO trade_executions            → bulk SELECT from staging with JOINs
   SELECT ... FROM staged_trades
   JOIN clients ON ...
   JOIN securities ON ...
3. INSERT INTO holdings                    → aggregate from staging
   SELECT client_id, isin, SUM(qty_delta)
   FROM staging GROUP BY ...
   ON CONFLICT DO UPDATE
4. TRUNCATE staged_trades                  → cleanup
```

**Expected performance:** 19,500 trades in **2-5 seconds**.

Requires direct PostgreSQL connection (not REST API). Available via Supabase's connection string or `pg` Node.js driver.

---

## 4. Performance Comparison Summary

| Approach | Queries | Time for 19,500 trades | Bottleneck |
|---|---|---|---|
| **Current (N+1 via REST)** | ~156,000 | ~1.5 hours | Network round-trips |
| **Option A: Stored Procedure** | ~4-8 | ~5-15 seconds | DB compute |
| **Option B: Bulk UNNEST via REST** | ~6-10 | ~30-60 seconds | REST payload size |
| **Option C: COPY + Staging** | ~4-5 | ~2-5 seconds | Disk I/O |

---

## 5. Key Takeaways

### The Golden Rules of Batch Processing

1. **Never loop over rows in application code when you can use SQL aggregation.** A `GROUP BY` with `ON CONFLICT DO UPDATE` replaces thousands of read-modify-write cycles.

2. **Minimize round-trips.** Each network call to the database costs 1-50ms. 100,000 calls = minutes of pure waiting. Batch everything into as few queries as possible.

3. **Use the database's strengths.** PostgreSQL is designed for set-based operations. Its query planner, hash joins, and sort-merge algorithms are optimized for processing millions of rows at once — far faster than application-level loops.

4. **Cache what you can, but prefer JOINs.** In-memory caches help, but a single SQL JOIN against a reference table eliminates the need for any cache.

5. **Edge Functions are orchestrators, not compute engines.** Use them to trigger stored procedures, not to run business logic. The 2-second CPU limit and 150-400 second wall clock make them unsuitable for batch processing.

6. **COPY > UNNEST > multi-row INSERT > single-row INSERT.** Each step up is 2-5x faster. For 10K+ rows, always use COPY or UNNEST.

7. **Commit in chunks.** One giant transaction locks resources and risks total rollback. Commit every 1,000-5,000 rows for resilience and concurrency.

### What We Should Have Done From the Start

The `process-trades` edge function should have been a **PostgreSQL stored procedure** from day one. The trade processing pipeline is fundamentally a set-based operation:

```
raw_trades (staging) → JOIN with clients, securities
                     → INSERT into trade_executions
                     → GROUP BY client+isin → UPSERT holdings
                     → compute cash deltas → INSERT cash_ledger
                     → UPDATE raw_trades.processed = true
```

This entire pipeline is expressible as a single SQL statement (or a small stored procedure with 4-5 queries). Moving it to the database layer would have:
- Eliminated 156,000 network round-trips
- Reduced processing time from 1.5 hours to under 15 seconds
- Avoided edge function timeout issues entirely
- Made the system idempotent by design (ON CONFLICT handles dedup)

### What We Actually Built: `bulk_process_trades()` SQL Function

After the edge function timed out trying to process 35,772 Jan 14 FILL/PF trades (each trade = ~6 sequential DB queries over HTTP = timeout at 200 trades), we built a **PL/pgSQL function** that runs the exact same logic directly inside PostgreSQL.

#### The Function: `bulk_process_trades(batch_size int DEFAULT 5000)`

```sql
SELECT bulk_process_trades(5000);
-- Returns: {"processed": 2467, "skipped": 2533, "failed": 0}
```

**What it does per trade (same as the edge function):**
1. Dedup check — skip if `exec_id` already in `trade_executions`
2. Resolve client — `bo_id` → `client_code` → create placeholder if missing
3. Resolve security — `security_code` → `isin` → create if missing
4. Calculate fees — commission (client-specific or default), exchange fee, CDBL (min ৳5), AIT
5. Settlement date — T+2 default, T+3 for Z, T+0/T+1 for spot (Fri/Sat = BD weekends)
6. Insert `trade_executions`
7. Update `holdings` — BUY: weighted avg cost; SELL: realized P&L
8. Insert `cash_ledger` — running balance
9. Mark `raw_trades.processed = true`

**Companion function:** `mark_nonfill_trades_processed()` — marks all non-FILL/PF trades (ACK, RPLD, CXLD, EXPIRED, REJ, null) as processed in bulk.

#### Performance Comparison: Edge Function vs SQL Function

| Metric | Edge Function (`process-trades`) | SQL Function (`bulk_process_trades`) |
|--------|----------------------------------|--------------------------------------|
| Per-trade queries | 6-8 over HTTP (PostgREST) | 6-8 in-process (no network) |
| Batch size | 200 (times out beyond this) | 5,000+ easily |
| 35,772 trades | **Impossible** (timeout) | **7 batches × ~30s = ~3.5 min** |
| Network overhead | ~30ms per query × 8 queries × 200 = 48s | 0ms (runs inside Postgres) |
| Failure mode | 504 Gateway Timeout, partial processing | Errors caught per-trade, continues processing |

#### How the FE Calls It

The `processTrades()` function in `useImport.ts` was updated to call the SQL function via Supabase RPC instead of the edge function:

```typescript
// OLD: Edge function (200 trades, times out)
const { data } = await supabase.functions.invoke('process-trades', { body: { ... } });

// NEW: SQL function (5000 trades, runs inside Postgres)
const { data } = await supabase.rpc('bulk_process_trades', { batch_size: 5000 });
```

The FE still loops until `processed === 0`, but each batch handles 25x more trades and never times out.

#### Why This Isn't the "Ideal" Set-Based Approach (Yet)

The SQL function still processes trades **one by one in a loop** (PL/pgSQL `FOR rec IN ... LOOP`). It's 25x faster than the edge function because it eliminates HTTP overhead, but it's still O(N) queries. The truly optimal approach (described in Architecture Option A above) would use JOINs, GROUP BY, and CTEs to process all trades in 4-6 queries regardless of count. That optimization remains for Phase 3.

#### Helper Function: `add_bd_business_days(start_date, num_days)`

Settlement date calculation requires Bangladesh business days (Fri/Sat = weekends). This was also moved to SQL:

```sql
-- Returns start_date + num_days business days (skipping Friday=5, Saturday=6)
SELECT add_bd_business_days('2026-01-14'::date, 2);  -- → 2026-01-18 (skips Fri/Sat)
```

---

## References

- [Tiger Data: Testing PostgreSQL Ingest Methods](https://www.tigerdata.com/learn/testing-postgres-ingest-insert-vs-batch-insert-vs-copy) — COPY is 14-19x faster than single INSERT
- [Supabase Edge Function Limits](https://supabase.com/docs/guides/functions/limits) — 2s CPU, 150-400s wall clock
- [PostgreSQL Documentation: Populating a Database](https://www.postgresql.org/docs/current/populate.html) — Official bulk loading guide
- [Pismo: From Batch Jobs to Event-Driven](https://www.pismo.io/blog/from-batch-jobs-to-an-event-driven-model/) — Hybrid staging + batch pattern
- [Supabase Cron](https://supabase.com/modules/cron) — pg_cron for scheduled stored procedure calls

---
---

# LEARNING: Trade Processing — Financial Terms & What's Actually Happening

## 1. The Big Picture: What Is UCB Stock Doing?

UCB Stock is a **stockbroker** — a licensed intermediary that executes buy and sell orders on behalf of clients on the **DSE (Dhaka Stock Exchange)** and **CSE (Chittagong Stock Exchange)**. Think of it like a shopkeeper: clients come and say "buy me 500 shares of BEXIMCO" or "sell my 200 shares of GP". UCB Stock executes these on the exchange, charges fees, and keeps track of every client's portfolio.

**The system we're building is the "back office"** — the accounting engine that runs after the trading day ends. Every evening, UCB Stock receives a file from the exchange listing every trade that happened that day. Our job is to process that file and update:
- What each client **owns** (holdings)
- How much **cash** each client has (cash ledger)
- How much **profit or loss** each client has made (P&L)
- What the client's portfolio is **worth today** (valuation)

This is called **End-of-Day (EOD) processing**.

---

## 2. The Trade Lifecycle: From Click to Settlement

Here's what happens when a client trades a stock:

```
 Client says "Buy 500 GP"
         │
         ▼
 ┌───────────────────┐
 │  ORDER PLACED     │  UCB Stock's trader submits the order to DSE
 │  Status: ACK      │  (Acknowledged — exchange received it)
 └────────┬──────────┘
          │
          ▼
 ┌───────────────────┐
 │  ORDER MATCHED    │  DSE's matching engine finds a seller
 │  Status: FILL     │  500 shares @ ৳85 each = ৳42,500
 │  or PF (Partial)  │  (PF = only some shares filled, e.g. got 300 of 500)
 └────────┬──────────┘
          │
          ▼
 ┌───────────────────┐
 │  TRADE EXECUTED   │  Now money and shares must change hands
 │  Settlement: T+2  │  (2 business days later)
 └────────┬──────────┘
          │
          ▼
 ┌───────────────────┐
 │  SETTLED          │  Buyer gets shares in their CDBL account
 │                   │  Seller gets cash
 └───────────────────┘
```

### Other Statuses (we ignore these)
- **RPLD** (Replaced) — client changed the order before it was filled
- **CXLD** (Cancelled) — client or system cancelled the order
- **EXPIRED** — order wasn't filled by end of session
- **REJ** (Rejected) — exchange rejected the order (invalid price, circuit breaker, etc.)

**Only FILL and PF trades affect positions and money.** Everything else is just "noise" in the trade file — that's why our system filters for `status IN ('FILL', 'PF')`.

---

## 3. Financial Terms Explained

### 3.1 Holdings (Position)

A **holding** = "Client X owns Y shares of Stock Z at an average cost of ৳W per share."

```
Example:
  Client: 15570 (JOYANTA KARMAKAR)
  Security: BEXIMCO
  Quantity: 500 shares
  Average Cost: ৳85.50 per share
  Total Invested: ৳42,750
```

The holdings table is the **current snapshot** of what each client owns. It gets updated every time a trade is processed.

### 3.2 Average Cost (Weighted Average)

When a client buys the same stock multiple times at different prices, we don't track each purchase separately. Instead, we compute a single **weighted average cost**:

```
Day 1: Buy 100 shares @ ৳80 = ৳8,000
Day 2: Buy 200 shares @ ৳90 = ৳18,000

Weighted Average = Total Cost / Total Shares
                 = (৳8,000 + ৳18,000) / (100 + 200)
                 = ৳26,000 / 300
                 = ৳86.67 per share
```

**Why weighted average?** It's the standard method in Bangladesh (and most markets). It smooths out price fluctuations and gives a fair "cost basis" for calculating profit/loss.

**Important:** Fees are included in the average cost for buys. If you buy 100 @ ৳80 and pay ৳240 in fees, your actual cost is ৳8,240, so avg_cost = ৳82.40.

### 3.3 Realized P&L (Realized Profit & Loss)

When you **sell** shares, you lock in a profit or loss. This is "realized" because the money is real — it's in your account.

```
You own 300 shares at avg_cost = ৳86.67
You sell 100 shares @ ৳95 (minus fees, net proceeds = ৳9,380)

Realized P&L = Net Proceeds - (Average Cost × Shares Sold)
             = ৳9,380 - (৳86.67 × 100)
             = ৳9,380 - ৳8,667
             = +৳713 profit

Your remaining holding: 200 shares at ৳86.67 (avg cost does NOT change on sells)
```

**Key rule:** Average cost never changes when you sell. You're just removing shares at the same cost basis.

### 3.4 Unrealized P&L

Profit or loss on shares you **still hold** — it's "paper" money, not yet locked in.

```
You hold 200 shares at avg_cost = ৳86.67
Today's market price = ৳92.00

Unrealized P&L = (Market Price - Average Cost) × Quantity
               = (৳92.00 - ৳86.67) × 200
               = ৳5.33 × 200
               = +৳1,066 (paper profit)
```

This changes every day as the market price moves. It only becomes "realized" when you sell.

### 3.5 Total Invested vs Total Cost

These are **not the same** in our system:

| Term | Definition | Changes on sells? |
|------|-----------|-------------------|
| **Total Invested** | Cumulative cost of all buys (including fees) | NO — it's a running total that only goes up |
| **Total Cost** | Current holdings value at cost = `quantity × average_cost` | YES — decreases as you sell shares |

**Total Cost** is what appears on the portfolio statement. **Total Invested** is an internal tracking field.

### 3.6 Market Value

What the client's shares are worth **right now** at current market prices.

```
Market Value = Quantity × Last Close Price
             = 200 shares × ৳92.00
             = ৳18,400
```

### 3.7 Cash Ledger (Running Balance)

The cash ledger is like a **bank statement** — every transaction is a new row with a running balance.

```
Row 1: Opening balance                    +৳500,000.00   Balance: ৳500,000.00
Row 2: BUY 500 GP @ ৳85 (+ fees)         -৳42,878.50   Balance: ৳457,121.50
Row 3: SELL 100 BEXIMCO @ ৳95 (- fees)    +৳9,380.00    Balance: ৳466,501.50
Row 4: Deposit                            +৳100,000.00   Balance: ৳566,501.50
```

**Key rule:** The ledger is **append-only** (immutable). You never edit a past row. If there's an error, you add a reversal entry.

The `running_balance` field on each row represents the client's cash balance **after** that transaction.

### 3.8 Net Value (of a trade)

The actual cash impact of a trade, including all fees:

```
BUY:  Net Value = Trade Value + All Fees    (you pay MORE than the stock price)
SELL: Net Value = Trade Value - All Fees    (you receive LESS than the stock price)
```

For a buy, net_value goes INTO average cost. For a sell, net_value is your actual proceeds.

---

## 4. Fee Structure: Who Gets Paid When You Trade

Every trade incurs 4 types of fees. These are deducted automatically:

| Fee | Rate | Who Gets It | Example (on ৳100,000 trade) |
|-----|------|-------------|----------------------------|
| **Brokerage Commission** | 0.30% (default, negotiable per client) | UCB Stock (the broker) | ৳300 |
| **Exchange Fee (Laga)** | 0.03% | DSE/CSE (the exchange) | ৳30 |
| **CDBL Fee** | 0.0175%, min ৳5 | CDBL (Central Depository — holds shares electronically) | ৳17.50 |
| **AIT** | 0.05% | Government (Advance Income Tax — tax on capital gains) | ৳50 |

**Total fees on a ৳100,000 trade: ৳397.50** (~0.4%)

### Client-Specific Commission Rate

Some clients negotiate a custom rate (stored in `clients.commission_rate`). When a client has a custom rate, it's **all-inclusive** — meaning exchange fee, CDBL, and AIT are bundled into that single rate. The system sets exchange_fee, cdbl_fee, and ait to 0 for these clients.

---

## 5. Settlement: When Does the Money Actually Move?

A trade doesn't settle instantly. **Settlement** = the actual transfer of shares and cash.

| Security Category | Settlement | Meaning |
|-------------------|-----------|---------|
| A, B, G, N | T+2 | 2 business days after trade |
| Z | T+3 | 3 business days (higher risk stocks) |
| Spot (forced) | T+0 sell, T+1 buy | Same-day or next-day |

**Business days** in Bangladesh = Sunday through Thursday (Friday & Saturday are weekends).

```
Example:
  Trade on Sunday Jan 12 (T)
  Category A → Settlement = T+2 = Tuesday Jan 14

  Trade on Wednesday Jan 15 (T)
  Category A → Settlement = T+2 = Monday Jan 19 (skips Fri & Sat)
```

### Saleable Quantity

Until a buy trade settles, those shares are **not saleable**. The client owns them but can't sell them yet.

```
Saleable = Total Quantity - Unsettled Buy Quantity
```

This is why the portfolio statement shows both "Quantity" and "Saleable" columns.

---

## 6. What Happens When We Process a Trade File

Here's the complete flow, step by step:

### Step 0: File Upload
The operations team uploads a **DSE XML file** (~30MB, 50,000+ order events) through the web UI. The frontend parser extracts every order event and inserts them into `raw_trades`.

### Step 1: Filter
Only **FILL** and **PF** (partial fill) with `quantity > 0` are actionable. Everything else (ACK, CXLD, RPLD, EXPIRED, REJ) is marked processed with no position impact.

### Step 2: Deduplicate
Each trade has a unique `exec_id`. If it already exists in `trade_executions`, skip it. This makes re-imports safe (idempotent).

### Step 3: Resolve Client
Map the `bo_id` (BOID — the client's depository account number) or `client_code` to our internal `client_id`. If the client doesn't exist, create a placeholder marked `pending_review`.

### Step 4: Resolve Security
Map the `security_code` (e.g., "BEXIMCO") to our internal `isin`. If not found, create a placeholder security.

### Step 5: Calculate Fees
Apply the 4 fee types based on the fee schedule. If the client has a custom commission rate, use that instead.

### Step 6: Calculate Settlement Date
Based on the security's category (A/B/G/N/Z) and whether it's a spot trade.

### Step 7: Insert Trade Execution
Store the validated trade with all computed fields (fees, net_value, settlement_date) in `trade_executions`.

### Step 8: Update Holdings
- **BUY:** Increase quantity, recalculate weighted average cost (including fees)
- **SELL:** Decrease quantity, calculate realized P&L, keep average cost unchanged

### Step 9: Update Cash Ledger
- **BUY:** Debit (subtract) the net_value from the client's cash balance
- **SELL:** Credit (add) the net_value to the client's cash balance

### Step 10: Mark Processed
Set `raw_trades.processed = true` so it's not picked up again.

---

## 7. The Ultimate Goal: Daily Portfolio Snapshot

After all trades are processed and daily prices are loaded, the EOD engine generates a **daily_snapshot** for each client:

```
Client: 15570 — JOYANTA KARMAKAR — Snapshot for 2026-01-13

Holdings:
  DOMINAGE     5,000 shares × ৳45.20 = ৳226,000  (cost: ৳200,000 → unrealized +৳26,000)
  FINEFOODS  277,169 shares × ৳8.90  = ৳2,466,804 (cost: ৳2,300,000 → unrealized +৳166,804)
  GQBALLPEN    2,000 shares × ৳120.00 = ৳240,000  (cost: ৳210,000 → unrealized +৳30,000)
  MKFOOTWEAR   3,500 shares × ৳61.50 = ৳215,250  (cost: ৳180,000 → unrealized +৳35,250)

Portfolio Value:     ৳3,148,054
Cash Balance:        ৳566,501.50
Total Portfolio:     ৳3,714,555.50
Total Invested:      ৳2,890,000
Total Unrealized PL: +৳258,054
Total Realized PL:   +৳12,500
```

This is what the Risk Manager, RM (Relationship Manager), and the client themselves ultimately need to see:
- **"How much is my portfolio worth?"**
- **"Am I making money or losing money?"**
- **"How much cash do I have available?"**
- **"Am I in a margin call?"** (if they borrowed money to trade)

---

## 8. Data Flow Summary

```
                    DSE XML Trade File (50,000 events)
                              │
                    ┌─────────▼──────────┐
                    │    raw_trades       │  Staging table (all events)
                    │    49,741 rows      │
                    └─────────┬──────────┘
                              │ Filter: FILL/PF only
                              │ (~19,500 trades)
                    ┌─────────▼──────────┐
                    │ trade_executions    │  Validated trades with fees
                    │   19,498 rows      │
                    └──┬─────────────┬───┘
                       │             │
              ┌────────▼───┐  ┌─────▼────────┐
              │  holdings   │  │  cash_ledger  │
              │  (updated)  │  │  (new entries) │
              │  75,530 rows│  │  per trade     │
              └──────┬──────┘  └──────┬────────┘
                     │                │
                     └───────┬────────┘
                    ┌────────▼────────┐
                    │ daily_snapshots  │  Portfolio valuation
                    │ (1 per client   │  = holdings × prices + cash
                    │  per day)       │
                    └─────────────────┘
```

---

## 9. Glossary Quick Reference

| Term | Plain English |
|------|--------------|
| **BOID** | Client's depository account number (like a bank account number for shares) |
| **ISIN** | International Securities Identification Number (unique ID for a stock globally) |
| **ExecID** | Unique ID for each trade execution on the exchange |
| **CDBL** | Central Depository Bangladesh Limited — the electronic vault that holds all shares |
| **DSE** | Dhaka Stock Exchange — the main stock exchange |
| **CSE** | Chittagong Stock Exchange — the secondary exchange |
| **EOD** | End of Day — the daily reconciliation process |
| **T+2** | Trade date plus 2 business days (settlement period) |
| **Margin** | Borrowed money to trade — client puts up some equity, broker lends the rest |
| **Margin Call** | "Your equity dropped too low — deposit more money or we sell your shares" |
| **Force Sell** | Broker sells client's shares because equity is critically low |
| **AIT** | Advance Income Tax — government tax collected at source on every trade |
| **Laga** | Exchange fee — the exchange's commission for facilitating the trade |
| **RLS** | Row Level Security — database-level access control (client X can only see their own data) |
| **Idempotent** | Re-running the same operation produces the same result (no duplicates) |
