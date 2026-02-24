/**
 * Consolidated trade summary by institution prefix for merchant bank / custodial accounts.
 * These are external institution BO accounts using UCB for trade execution.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://zuupegtizrvbnsliuddu.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp1dXBlZ3RpenJ2Ym5zbGl1ZGR1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTg3ODE1NCwiZXhwIjoyMDg3NDU0MTU0fQ.fE4D9Y0mFGzY6NT2aqnA9MLQJqHVQRB5VGo6II0zKx0';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Institution prefix → name mapping
const INSTITUTION_MAP = {
  'CU': 'Custodial Accounts',
  'CM': 'Merchant Bank Accounts',
  'CN': 'Merchant Bank Accounts (CN)',
  'CL': 'Clearing/Custodial Accounts',
  'GCML': 'GCML Institutional',
  'FN': 'Finance Institutional',
  'DH': 'Dhaka Institutional',
  'CH': 'Chattogram Branch',
  'GZ': 'Strategic Portfolio Management (ND)',
  '9999': 'House/Suspense Account',
};

const fmt = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });

async function main() {
  // Step 1: Update clients with institutional account_type and category
  console.log('=== Step 1: Updating client records with institutional info ===\n');

  const targetCodes = [
    'GCML10004','CN423','CU100','CU65','CU06','CM769','GCML09','GZ106','FN08',
    'CH59','CL0162','CM420','CL0151','CM875','9999','CU108','CN414','CH81',
    'GZ11','CL0134','CL0104','CU72','CL0008','GZ08','CU99','DH05','CU118','CM1041','CU116'
  ];

  const { data: clients } = await supabase.from('clients')
    .select('client_id, client_code, bo_id, name')
    .in('client_code', targetCodes);

  let updated = 0;
  for (const c of clients) {
    const prefix = c.client_code.replace(/[0-9]+$/, '') || c.client_code;
    const institution = INSTITUTION_MAP[prefix] || 'External Institution';

    const { error } = await supabase.from('clients').update({
      name: institution + ' - ' + c.client_code,
      account_type: 'Institutional',
      department: institution,
    }).eq('client_id', c.client_id);

    if (error) {
      console.log(`  FAILED ${c.client_code}: ${error.message}`);
    } else {
      updated++;
      console.log(`  ${c.client_code} → ${institution} (Institutional)`);
    }
  }
  console.log(`\nUpdated: ${updated}/${clients.length}\n`);

  // Step 2: Get all trade_executions for these clients
  console.log('=== Step 2: Consolidated Trade Summary by Institution ===\n');

  const clientIds = clients.map(c => c.client_id);
  const idToCode = new Map();
  for (const c of clients) idToCode.set(c.client_id, c.client_code);

  // Fetch in batches if needed
  let allTrades = [];
  for (let i = 0; i < clientIds.length; i += 50) {
    const batch = clientIds.slice(i, i + 50);
    const { data: trades } = await supabase.from('trade_executions')
      .select('client_id, side, quantity, price, value, net_value, commission, exchange_fee, cdbl_fee, ait, trade_date, isin')
      .in('client_id', batch);
    if (trades) allTrades = allTrades.concat(trades);
  }

  // Group by prefix
  const prefixData = new Map();
  for (const t of allTrades) {
    const code = idToCode.get(t.client_id);
    const prefix = code.replace(/[0-9]+$/, '') || code;
    if (!prefixData.has(prefix)) {
      prefixData.set(prefix, {
        institution: INSTITUTION_MAP[prefix] || 'External',
        clients: new Set(),
        buys: 0, sells: 0,
        buyValue: 0, sellValue: 0,
        buyNet: 0, sellNet: 0,
        totalComm: 0, totalExFee: 0, totalCdbl: 0, totalAit: 0,
        trades: 0,
      });
    }
    const p = prefixData.get(prefix);
    p.clients.add(code);
    p.trades++;
    const val = Number(t.value) || 0;
    const net = Number(t.net_value) || 0;
    if (t.side === 'BUY') {
      p.buys++;
      p.buyValue += val;
      p.buyNet += net;
    } else {
      p.sells++;
      p.sellValue += val;
      p.sellNet += net;
    }
    p.totalComm += Number(t.commission) || 0;
    p.totalExFee += Number(t.exchange_fee) || 0;
    p.totalCdbl += Number(t.cdbl_fee) || 0;
    p.totalAit += Number(t.ait) || 0;
  }

  console.log('Trade Date: 2026-02-01\n');

  let grandBuyVal = 0, grandSellVal = 0, grandBuyNet = 0, grandSellNet = 0;
  let grandComm = 0, grandExFee = 0, grandCdbl = 0, grandAit = 0;
  let grandTrades = 0;

  for (const [prefix, d] of [...prefixData.entries()].sort()) {
    // Net payable: buyNet - sellNet (positive = client owes UCB for net purchases)
    const netPayable = d.buyNet - d.sellNet;

    console.log(`┌─── ${prefix} | ${d.institution} ───`);
    console.log(`│  Accounts: ${[...d.clients].join(', ')}`);
    console.log(`│  Trades: ${d.trades} (BUY: ${d.buys}, SELL: ${d.sells})`);
    console.log(`│`);
    console.log(`│  Buy Turnover:    BDT ${fmt(d.buyValue)}`);
    console.log(`│  Buy Net Cost:    BDT ${fmt(d.buyNet)}`);
    console.log(`│  Sell Turnover:   BDT ${fmt(d.sellValue)}`);
    console.log(`│  Sell Net Proc:   BDT ${fmt(d.sellNet)}`);
    console.log(`│`);
    console.log(`│  Commission:      BDT ${fmt(d.totalComm)}`);
    console.log(`│  Exchange Fee:    BDT ${fmt(d.totalExFee)}`);
    console.log(`│  CDBL Fee:        BDT ${fmt(d.totalCdbl)}`);
    console.log(`│  AIT:             BDT ${fmt(d.totalAit)}`);
    console.log(`│`);
    if (netPayable > 0) {
      console.log(`│  ► RECEIPT from client: BDT ${fmt(netPayable)}`);
    } else if (netPayable < 0) {
      console.log(`│  ► PAYMENT to client:  BDT ${fmt(Math.abs(netPayable))}`);
    } else {
      console.log(`│  ► NET ZERO`);
    }
    console.log(`└────────────────────────────────\n`);

    grandBuyVal += d.buyValue;
    grandSellVal += d.sellValue;
    grandBuyNet += d.buyNet;
    grandSellNet += d.sellNet;
    grandComm += d.totalComm;
    grandExFee += d.totalExFee;
    grandCdbl += d.totalCdbl;
    grandAit += d.totalAit;
    grandTrades += d.trades;
  }

  const grandNet = grandBuyNet - grandSellNet;
  console.log(`╔══════════════════════════════════╗`);
  console.log(`║     GRAND TOTAL (ALL INSTITUTIONS)    ║`);
  console.log(`╠══════════════════════════════════╣`);
  console.log(`║  Total Trades:     ${grandTrades}`);
  console.log(`║  Buy Turnover:     BDT ${fmt(grandBuyVal)}`);
  console.log(`║  Sell Turnover:    BDT ${fmt(grandSellVal)}`);
  console.log(`║  Total Commission: BDT ${fmt(grandComm)}`);
  console.log(`║  Total Ex Fee:     BDT ${fmt(grandExFee)}`);
  console.log(`║  Total CDBL:       BDT ${fmt(grandCdbl)}`);
  console.log(`║  Total AIT:        BDT ${fmt(grandAit)}`);
  console.log(`║`);
  if (grandNet > 0) {
    console.log(`║  ► NET RECEIPT:    BDT ${fmt(grandNet)}`);
  } else {
    console.log(`║  ► NET PAYMENT:    BDT ${fmt(Math.abs(grandNet))}`);
  }
  console.log(`╚══════════════════════════════════╝`);
}

main().catch(console.error);
