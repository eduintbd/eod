# BSEC Margin Rules 2025 — Complete Analysis & Implementation Gap Report

**Source:** Bangladesh Gazette, Extraordinary Issue, November 6, 2025
**Law:** Bangladesh Securities and Exchange Commission (Margin) Rules, 2025
**Replaces:** Margin Rules, 1999

---

## Section-by-Section Analysis

### Section 1: Short Title & Commencement
- Gazette: November 6, 2025
- **Implementation:** N/A (informational)

### Section 2: Definitions (ধারা ২)
Key legal definitions extracted from the Bengali text with English terms:

| # | Bengali Term | English Term | Definition |
|---|-------------|-------------|------------|
| 1 | জোরপূর্বক বিক্রি | Forced Sale | Compulsory sale by margin financer to recover margin |
| 2 | ইক্যুইটি | Equity | Portfolio Value minus Margin Financing outstanding |
| 3 | বিবেচনামূলক হিসাব | Discretionary Account | Account where portfolio manager has full trading authority |
| 4 | অবিবেচনামূলক হিসাব | Non-Discretionary Account | Account where client makes all trading decisions |
| 5 | নগদ হিসাব | Cash Account | Account funded entirely by client's own funds |
| 6 | প্রারম্ভিক মার্জিন | Initial Margin | Amount client must deposit before margin financing begins |
| 7 | পোর্টফলিও মূল্য | Portfolio Value | Market value of all securities in client's margin account |
| 10 | মার্জিন | Margin | Marginable securities held as collateral |
| 11 | মার্জিন অর্থায়ন | Margin Financing | Credit extended against marginable securities |
| 12 | মার্জিন অর্থায়ন সংস্থা | Margin Financer | Broker-dealer / Portfolio Manager authorized to provide margin |
| 13 | মার্জিন অর্থায়নযোগ্য সিকিউরিটিজ | Margin Financeable Security | Security eligible per Section 10 criteria |
| 14 | মার্জিন কল | Margin Call | Demand to restore equity when maintenance margin breached |
| 15 | মার্জিন হিসাব | Margin Account | Client account with margin agreement per Section 6 |
| 16 | মুখ্য বোর্ড | Main Board | Main trading board; EXCLUDES ATB, OTC, SME platforms |
| 17 | রক্ষণাবেক্ষণ মার্জিন | Maintenance Margin | Minimum equity / portfolio ratio per Section 9(1) |

**Implementation Status:** ✅ Mostly covered in schema. Missing: `discretionary_account` flag, `initial_margin` tracking.

---

### Section 3: Margin Financer (ধারা ৩)
- Must comply with BSEC Risk Based Capital Adequacy Rules, 2019
- BSEC can set conditions at Section 5(6) discretion
- BSEC can revoke margin financing authorization

**Implementation:** N/A (organizational compliance, not software)

---

### Section 4: Separate Bank Account (ধারা ৪)
- Margin financer must maintain a **separate bank account** for margin financing funds
- Branch-wise separate accounts required
- Cannot use consolidated customers' account for margin financing

**Implementation:** N/A (bank operations, not software)

---

### Section 5: Margin Account (ধারা ৫)

| Sub | Rule | Current Status |
|-----|------|---------------|
| 5(1) | Client must sign margin agreement + declaration before opening margin account | ❌ Not tracked |
| 5(2) | **Single margin account** per client per financer | ✅ Schema enforces (margin_accounts PK = client_id) |
| 5(3) | **Single cash account** alongside margin account | ✅ cash_ledger per client |
| 5(4) | Must also maintain a **cash account** (not margin-funded) | ❌ No distinction cash vs margin in cash_ledger |
| 5(5) | **No discretionary accounts** for margin financing | ❌ Not tracked/enforced |
| 5(6) | Cannot provide margin to directors, employees, family of financer | ❌ No relationship tracking |
| 5(7) | Financer's **own portfolio** must be completely separate from client margin | N/A (operational) |
| 5(8) | **KYC** + **risk assessment and analysis** required before margin approval | ❌ No KYC tracking |
| 5(9) | Students, homemakers, retired → **NO margin** (unless HNI) | ⚠️ `income_status` field exists but not enforced |

**GAP PRIORITY: HIGH**
- Need to enforce `income_status` check: reject margin for `student`, `homemaker`, `retired` unless HNI
- Need `kyc_completed` enforcement for margin accounts

---

### Section 6: Margin Agreement (ধারা ৬)

| Sub | Rule | Current Status |
|-----|------|---------------|
| 6(1) | Written agreement with stamp duty required before margin | ❌ Not tracked |
| 6(5) | Agreement valid for **30 days** (০৩ মাস = 30 days), renewable with review | ❌ No agreement tracking |
| 6(6) | After agreement, **30 days** to open account, else require fresh declaration | ❌ |
| 6(8) | KYC + risk assessment mandatory before margin financing | ❌ Same as 5(8) |

**GAP PRIORITY: LOW** (documentation/process, not core risk calculation)

---

### Section 7: Margin Preservation & Financing (ধারা ৭) ⭐ CRITICAL

| Sub | Rule | Current Status |
|-----|------|---------------|
| 7(1) | Must maintain **initial margin** AND **maintenance margin** | ⚠️ Maintenance tracked, initial margin not |
| 7(4) | Only **marginable securities** accepted as margin collateral; balance must be **cash** | ❌ Not distinguishing marginable vs non-marginable in portfolio value calc |
| 7(5) | **Equity:Margin ratio must be 1:1** (equity >= margin financing) | ✅ Implemented as 75% threshold |
| 7(5) proviso 1 | **If overall market P/E > 20 → ratio capped at 1:0.5** | ❌ NOT IMPLEMENTED |
| 7(5) proviso 2 | If market P/E > 20, BSEC determines effective date | ❌ |
| 7(6) | **Dynamic ratios by portfolio size:** | ❌ NOT IMPLEMENTED |
| 7(6)(a) | Portfolio **5-10 lakh (৫ লক্ষ)**: equity:margin = **1:0.5** | ❌ |
| 7(6)(b) | Portfolio **10+ lakh (১০ লক্ষ)**: equity:margin = **1:1** | ❌ |
| 7(6)(c) | **Life insurance companies**: ratio = **1:0.25** (requires actuarial valuation) | ❌ |
| 7(7) | Life insurance shares → BSEC can change eligibility criteria | N/A |
| 7(8) | **Unrealized gains CANNOT be used** for new margin financing | ❌ NOT IMPLEMENTED |
| 7(8) proviso | Existing margin can only be expanded using **realized gains** | ❌ |
| 7(9) | Total margin financing **cannot exceed 3x core capital/net worth** | ❌ Not tracked (firm-level limit) |

**GAP PRIORITY: CRITICAL**
- Market P/E cap rule needs implementation
- Dynamic ratio by portfolio size needs implementation
- Unrealized gain restriction needs implementation
- Portfolio value calculation must only count marginable securities

---

### Section 8: Own Policy (ধারা ৮)
Margin financer must have internal risk policy covering:
- (a) Enterprise risk
- (b) Credit risk
- (c) Market risk
- (d) Systematic risk
- (e) Conflict of interest

Policy must include conservative approach for:
- (a) Section 7(5): margin ratio limits
- (b) Section 9: margin call & forced selling procedures
- (c) Section 10: marginable security criteria
- (d) Section 11: prohibitions compliance
- (e) Section 12: other prohibitions compliance
- (f) Section 16: single client exposure limit
- (g) Section 17: single security exposure limit

Risk assessment review frequency: **minimum every 4 months**

**Implementation:** N/A (policy document, not software). But software should support configurable thresholds.

---

### Section 9: Margin Call & Forced Sale (ধারা ৯) ⭐ CRITICAL

| Sub | Rule | Current Status |
|-----|------|---------------|
| 9(1) | **Maintenance margin**: Equity >= **75%** of margin financing, Portfolio Value >= **175%** of margin financing | ✅ NORMAL_THRESHOLD = 0.75 |
| 9(2) | If equity or portfolio breaches 9(1) thresholds → **immediate margin call** | ✅ Alert generated |
| 9(2) proviso | Margin call via: **writing, email, SMS, WhatsApp** | ⚠️ Alert stored, but no SMS/WhatsApp integration |
| 9(3) | Client has **3 business days** to restore margin | ❌ NOT IMPLEMENTED (no deadline tracking) |
| 9(3) | If NOT restored in 3 days AND equity still < 75% / PV < 175% → **forced sale** | ❌ No 3-day countdown |
| 9(3) proviso | If equity < 75% but restored enough to avoid further deterioration, financer must still sell to bring back to maintenance level | ❌ |
| 9(4) | **FORCE SELL**: If equity <= **50%** of margin OR Portfolio Value <= **150%** of margin → **immediate forced sale WITHOUT prior notice** | ✅ FORCE_SELL_THRESHOLD = 0.50 |
| 9(5) | Forced sale must be executed per BSEC/Exchange trading rules | N/A (operational) |

**GAP PRIORITY: HIGH**
- Need **3 business day countdown** after margin call before forced sale
- Need margin call **deadline tracking** (margin_call_deadline date field)
- Need **notification channel tracking** (SMS sent? WhatsApp sent? Email sent?)

---

### Section 10: Margin Financeable Security (ধারা ১০) ⭐ CRITICAL

| Sub | Rule | Current Implementation |
|-----|------|----------------------|
| 10(1) | Only **'A' and 'B' category** shares on **Main Board** are marginable | ❌ `is_marginable` exists but not auto-classified |
| 10(1) proviso 1 | **'B' category**: only if company pays **minimum 5% annual dividend** | ❌ No dividend data |
| 10(1) proviso 2 | If 'A'/'B' share **downgraded to 'Z'**, or 'B' share loses 5% dividend → notify client, **forced sell within 60 trading days** | ❌ No category change tracking |
| 10(1) proviso 3 | After 60 trading days → forced sale per Section 9(4) | ❌ |
| 10(2) | **SME, ATB, OTC** platform securities → **NOT marginable** | ⚠️ Board field exists, not enforced |
| 10(3) | If marginable security becomes **non-marginable** mid-term → notify + sell within 60 trading days (per Section 6 schedule) | ❌ No transition tracking |

**GAP PRIORITY: CRITICAL**

---

### Section 11: Prohibitions on Margin Securities (ধারা ১১) ⭐ CRITICAL

| Sub | Rule | Current Implementation |
|-----|------|----------------------|
| 11(1) | Minimum holding period: 30 days cash investment; security must be worth **5 lakh** or more for margin eligibility | ❌ Not tracked |
| 11(1) proviso | Only **marginable securities** can be kept in margin account | ❌ Not enforced |
| 11(2) | If margin-funded security's value drops below **5 lakh** threshold → no additional margin | ❌ |
| 11(2) proviso | BSEC defines "any single client" | N/A |
| 11(3) | **Free float market cap < BDT 50 Crore → NOT marginable** | ⚠️ `free_float_market_cap` field exists, not enforced |
| 11(3) proviso | If existing marginable security's FFMC drops below 50Cr → notify + forced sell within 60 trading days | ❌ |
| 11(4) | **Trailing P/E > 30 → NOT marginable** | ⚠️ `trailing_pe` field exists, not enforced |
| 11(4) proviso | Also NOT marginable if P/E > **2x sectoral median P/E** (whichever is lower) | ❌ No sectoral median calc |
| 11(5) | **P/E calculation**: Closing Price ÷ (last 4 quarters' audited EPS) | ❌ No EPS data |
| 11(5) proviso 1 | P/E should be calculated by BSEC/Exchange if needed | N/A |
| 11(5) proviso 2 | **Negative EPS → NOT marginable**; sectoral P/E should not include negative EPS companies | ❌ |
| 11(6) | **Going concern threat** or **qualified audit opinion** → NOT marginable | ❌ No audit opinion data |
| 11(7) | Company **operations suspended** → NOT marginable | ❌ No operational status tracking |
| 11(8) | Categories **'N', 'Z', 'G'** → NOT marginable at any time | ⚠️ Category field exists, not enforced |
| 11(9) | **Mutual fund** (closed-end) listed securities → NOT marginable | ❌ Not distinguished |
| 11(10) | Financer's own **related party** shares → NOT marginable for that financer | N/A (firm-specific) |
| 11(11) | Cannot use **IPO allotment** for margin until listing and free trading | ❌ |
| 11(12) | Suspended securities → not marginable; once lifted, can resume | ❌ |
| 11(13) | **Locked-in, liened, blocked, directors' shares** → NOT marginable | ❌ |

**GAP PRIORITY: CRITICAL**

---

### Section 12: Other Prohibitions (ধারা ১২)

| Sub | Rule |
|-----|------|
| 12(1) | Cannot use margin for **takeover** or significant acquisition |
| 12(2) | Cannot use margin to become a **director** |
| 12(3) | Margin-funded securities cannot be **pledged** elsewhere |
| 12(4) | Cannot margin against **directors' shares**, locked-in, lien, pledge |
| 12(5) | Cannot use margin account securities as collateral for **other loans** |

**Implementation:** N/A (enforcement/compliance, not automated calculation)

---

### Section 13: Factors to Consider (ধারা ১৩)
When providing margin, financer should evaluate:
- (a) Solvency
- (b) Fundamentals (financial performance, dividend history)
- (c) Liquidity and tradability
- (d) Capital appreciation potential
- (e) Risk factors
- (f) Market sentiment
- (g) Price trend

**Implementation:** N/A (human judgment, but data for these factors should be available in the system)

---

### Section 14: Research Team (ধারা ১৪)
- Must have qualified **research team** for risk assessment
- Minimum **3 members** with relevant qualifications

**Implementation:** N/A (organizational)

---

### Section 15: Margin Financing Operations (ধারা ১৫)

| Sub | Rule | Current Status |
|-----|------|---------------|
| 15(1) | Margin limit per Section 7(5) and (6) apply | See Section 7 gaps |
| 15(2) | Interest/fees must be paid in **cash only** (not capitalized) | ❌ Not enforced |
| 15(3) | Interest/costs **cannot be capitalized** into margin loan | ❌ |
| 15(4) | Forced selling per Section 9(4) should NOT be used to recover interest | ❌ |
| 15(5) | Interest rate must be disclosed upfront | N/A |

**GAP PRIORITY: MEDIUM** (interest tracking not in scope for Phase 2, but important for Phase 3)

---

### Section 16: Portfolio Value = Closing Price (ধারা ১৬)
- Portfolio value MUST be calculated using **most recent closing price** for each security
- This is used for margin call and forced sale calculations

**Current Status:** ✅ Implemented (uses daily_prices close_price with fallback chain)

---

### Section 17: Single Client Exposure Limit (ধারা ১৭)

| Rule | Current Status |
|------|---------------|
| **15% of core capital/net worth** OR **BDT 10 Crore**, whichever is **lower** | ❌ NOT IMPLEMENTED |
| BSEC can adjust this limit per Section 1 proviso | ❌ |

**GAP PRIORITY: HIGH** (needs firm-level configuration)

---

### Section 18: Single Security Exposure Limit (ধারা ১৮)

| Rule | Current Status |
|------|---------------|
| No more than **15% of total outstanding margin** in a **single security** | ❌ NOT IMPLEMENTED |
| BSEC can adjust per Section 1 proviso | ❌ |

**GAP PRIORITY: HIGH** (needs aggregate tracking across all clients)

---

### Section 19: Custodian of Security (ধারা ১৯)
- Financer is custodian of margin securities
- Securities held in **client's BO account** with **lien mark** in financer's favor
- Financer cannot mix client securities with own portfolio
- Must maintain un-editable back-office system with audit trail
- Transaction-wise records with backup

**Current Status:** ✅ Partially (audit trail exists via cash_ledger append-only model)

---

### Section 20: Submission/Reporting (ধারা ২০)
- Daily online reporting to BSEC
- Report to exchange and BSEC (if portfolio manager)
- **Top 20 clients** report with outstanding > **10 Crore** threshold

**Current Status:** ❌ No BSEC reporting module (Phase 3)

---

### Section 21: Inspection (ধারা ২১)
- BSEC can inspect at any time
- Must provide all documents, data within **15 days** of request

**Implementation:** N/A (compliance process)

---

### Section 22: Account Closure (ধারা ২২)
- Client can close with **15 days notice**
- Outstanding debts must be settled before closure
- Unclaimed amounts → **suspense account**

**Current Status:** ❌ No account closure workflow

---

### Section 23: Provisioning (ধারা ২৩)

| Rule | Current Status |
|------|---------------|
| **1% general provision** on total outstanding margin financing | ❌ NOT TRACKED |
| IFRS compliance for additional provisioning | ❌ |

**GAP PRIORITY: MEDIUM**

---

### Section 24: Complaints & Remedies (ধারা ২৪)
- Client complaint mechanism required
- Resolve within 15 working days or escalate to BSEC

**Implementation:** N/A (Phase 3 CRM)

---

### Section 25: Penalties (ধারা ২৫)
- Violations punishable under Securities & Exchange Ordinance, 1969

**Implementation:** N/A

---

### Section 26: Repeal & Savings (ধারা ২৬)
- Repeals Margin Rules, 1999 (dated October 30, 2025)
- Existing cases under old rules continue under old provisions
- Also repeals relevant sections of BSEC Portfolio Manager Rules, 1996 Section 36

---

## Schedule (তফসিল) — Margin Agreement Template

The law includes a mandatory **margin agreement format** (Schedule under Section 6) with these key clauses:

1. Agreement parties: Margin Financer ("First Party") and Client ("Second Party")
2. Must contain full identification details
3. Stipulates:
   - (a) Only marginable securities can be purchased with margin; balance in cash
   - (b) Maintenance margin: Portfolio Value >= **175%** of margin financing
   - (c) Margin call per Section 9 ("First Party" issues call, "Second Party" forced sale)
   - (d) If Portfolio Value drops to **150%** of margin → immediate forced sale
   - (e) After agreement, account opened per these rules
   - (f) Section 5(1) declaration required
   - (g) Interest charged quarterly: must disclose cumulative interest and accrued interest in tabular form

---

## IMPLEMENTATION PRIORITY MATRIX

### 🔴 CRITICAL (Must implement for legal compliance)

| # | Feature | Sections | Effort |
|---|---------|----------|--------|
| 1 | **Security marginability auto-classifier** | 10, 11 | Medium |
| 2 | **Market P/E > 20 cap rule** (ratio → 1:0.5) | 7(5) | Low |
| 3 | **Portfolio-size dynamic ratios** (5-10L → 1:0.5, 10L+ → 1:1) | 7(6) | Medium |
| 4 | **Only marginable securities** count in margin portfolio value | 7(4), 10 | Medium |
| 5 | **Unrealized gain restriction** | 7(8) | Medium |
| 6 | **3 business day margin call deadline** | 9(3) | Low |
| 7 | **60 trading day forced sell** on category downgrade | 10(1), 11(3) | Medium |

### 🟡 HIGH (Should implement soon)

| # | Feature | Sections | Effort |
|---|---------|----------|--------|
| 8 | **Single client exposure limit** (15% of capital or 10Cr) | 17 | Medium |
| 9 | **Single security exposure limit** (15% of total outstanding) | 18 | Medium |
| 10 | **Income status enforcement** (no margin for student/homemaker/retired) | 5(9) | Low |
| 11 | **Negative EPS → not marginable** | 11(5) | Low |
| 12 | **Sectoral median P/E** calculation | 11(4) | Medium |
| 13 | **Notification channel tracking** (SMS, email, WhatsApp flags) | 9(2) | Low |

### 🟢 MEDIUM (Phase 3 scope)

| # | Feature | Sections | Effort |
|---|---------|----------|--------|
| 14 | Interest tracking (cash-only, no capitalization) | 15 | Medium |
| 15 | Provisioning (1% general provision) | 23 | Low |
| 16 | BSEC reporting module (daily, top-20 clients) | 20 | High |
| 17 | Account closure workflow | 22 | Medium |
| 18 | Complaint management | 24 | Medium |

---

## CURRENT IMPLEMENTATION vs LAW — SUMMARY

### What We Have Right (✅)
1. Three-tier status: NORMAL / MARGIN_CALL / FORCE_SELL
2. Thresholds: 75% (maintenance) and 50% (force sell) ← correct
3. Portfolio value using closing prices with fallback chain
4. Alert generation on status transition
5. Daily snapshot tracking (portfolio, cash, loan, equity, margin utilization)
6. `is_marginable` flag on securities table
7. `income_status` field on clients table
8. `category`, `trailing_pe`, `free_float_market_cap` fields on securities

### What We Have Wrong or Missing (❌)
1. **No market P/E check** — when overall market P/E > 20, all ratios should cap at 1:0.5
2. **No dynamic ratios by portfolio size** — currently uses fixed 75%/50% for all
3. **No marginability auto-classification** — `is_marginable` is always `false`
4. **Portfolio value includes ALL holdings** — should only count marginable securities for margin calc
5. **No 3-day margin call deadline** — alert fires but no countdown
6. **No category change monitoring** — no 60-day forced sell tracking
7. **No exposure limits** — single client and single security limits not tracked
8. **No unrealized gain restriction** — margin can expand on unrealized gains
9. **No sectoral median P/E** calculation
10. **No negative EPS exclusion** logic
11. **No notification channel tracking** on margin alerts

---

## DATABASE SCHEMA CHANGES NEEDED

### New columns on `securities`:
```sql
-- For marginability classification
ALTER TABLE securities ADD COLUMN eps NUMERIC;                    -- Trailing EPS (last 4 quarters)
ALTER TABLE securities ADD COLUMN annual_dividend_pct NUMERIC;    -- Annual dividend as % of face value
ALTER TABLE securities ADD COLUMN has_going_concern_risk BOOLEAN DEFAULT FALSE;
ALTER TABLE securities ADD COLUMN has_qualified_opinion BOOLEAN DEFAULT FALSE;
ALTER TABLE securities ADD COLUMN is_operations_suspended BOOLEAN DEFAULT FALSE;
ALTER TABLE securities ADD COLUMN marginability_reason TEXT;      -- Why marginable/not
ALTER TABLE securities ADD COLUMN marginability_updated_at TIMESTAMPTZ;
```

### New columns on `margin_accounts`:
```sql
ALTER TABLE margin_accounts ADD COLUMN margin_call_deadline DATE;           -- 3 business days from call
ALTER TABLE margin_accounts ADD COLUMN marginable_portfolio_value NUMERIC;  -- Only marginable securities
ALTER TABLE margin_accounts ADD COLUMN applied_ratio TEXT DEFAULT '1:1';    -- Dynamic ratio applied
```

### New columns on `margin_alerts`:
```sql
ALTER TABLE margin_alerts ADD COLUMN notification_email_sent BOOLEAN DEFAULT FALSE;
ALTER TABLE margin_alerts ADD COLUMN notification_sms_sent BOOLEAN DEFAULT FALSE;
ALTER TABLE margin_alerts ADD COLUMN notification_whatsapp_sent BOOLEAN DEFAULT FALSE;
ALTER TABLE margin_alerts ADD COLUMN deadline_date DATE;  -- 3 business days for margin call
```

### New table: `margin_config` (firm-level settings)
```sql
CREATE TABLE margin_config (
  id SERIAL PRIMARY KEY,
  config_key TEXT UNIQUE NOT NULL,
  config_value NUMERIC NOT NULL,
  description TEXT,
  effective_from DATE DEFAULT CURRENT_DATE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed data:
-- core_capital_net_worth → firm's core capital (for exposure limits)
-- market_pe → current overall market P/E ratio
-- market_pe_cap_active → 1 if market P/E > 20 cap is in effect
-- single_client_limit_pct → 0.15 (15%)
-- single_client_limit_max → 100000000 (10 Crore)
-- single_security_limit_pct → 0.15 (15%)
-- general_provision_rate → 0.01 (1%)
```

### New table: `security_category_changes` (60-day tracking)
```sql
CREATE TABLE security_category_changes (
  id BIGSERIAL PRIMARY KEY,
  isin TEXT NOT NULL REFERENCES securities(isin),
  old_category TEXT,
  new_category TEXT,
  change_date DATE NOT NULL,
  forced_sell_deadline DATE NOT NULL, -- change_date + 60 trading days
  status TEXT DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMPLETED', 'EXPIRED')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## EDGE FUNCTION CHANGES NEEDED

### `calculate-margins/index.ts` — Major Changes:

1. **Filter marginable securities only** when calculating portfolio value for margin
2. **Load `margin_config`** for market P/E and firm limits
3. **Apply dynamic ratio** based on portfolio size:
   - Portfolio 5-10L → equity must be >= 66.7% (ratio 1:0.5 means equity covers 2/3)
   - Portfolio 10L+ → equity must be >= 50% (ratio 1:1 means equity covers 1/2)
   - If market P/E > 20 → cap at 1:0.5 regardless of portfolio size
4. **Set margin_call_deadline** = margin_call_date + 3 Bangladesh business days
5. **Check exposure limits** (single client, single security)
6. **Track unrealized gains** — flag if margin expansion is based on unrealized gains

### New Edge Function: `classify-marginability`
Auto-classify securities as marginable/non-marginable based on:
- Category A on Main Board → marginable (if other criteria met)
- Category B on Main Board → marginable only if annual dividend >= 5%
- Category N, Z, G, S → NOT marginable
- Board SME, ATB, OTC → NOT marginable
- Free float market cap < 50 Crore → NOT marginable
- Trailing P/E > 30 → NOT marginable
- P/E > 2x sectoral median P/E → NOT marginable
- Negative EPS → NOT marginable
- Going concern risk / qualified opinion → NOT marginable
- Operations suspended → NOT marginable

---

## Sources
- [Official BSEC Laws Page](https://sec.gov.bd/home/laws)
- [Key Changes Analysis - Royal Capital Adda](https://adda.royalcapitalbd.com/key-changes-in-bangladeshs-new-margin-rules-2025-bsecs-push-for-market-stability/)
- [TBS News - New margin rules gazetted](https://www.tbsnews.net/economy/stocks/new-margin-rules-gazetted-existing-cases-follow-old-regulations-1279141)
- [The New Nation - BSEC launches new margin rules](https://dailynewnation.com/bsec-launches-new-margin-rules-signals-reform-in-capital-market/)
