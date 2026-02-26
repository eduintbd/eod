import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://zuupegtizrvbnsliuddu.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp1dXBlZ3RpenJ2Ym5zbGl1ZGR1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTg3ODE1NCwiZXhwIjoyMDg3NDU0MTU0fQ.fE4D9Y0mFGzY6NT2aqnA9MLQJqHVQRB5VGo6II0zKx0';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function hr(title) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`  ${title}`);
  console.log('='.repeat(80));
}

async function main() {
  // ───────────────────────────────────────────────────────
  // Query 1: Failed trades (processed=true, error_message not null)
  // ───────────────────────────────────────────────────────
  hr('1. Count of raw_trades: processed=true AND error_message IS NOT NULL');
  {
    const { count, error } = await supabase
      .from('raw_trades')
      .select('*', { count: 'exact', head: true })
      .eq('processed', true)
      .not('error_message', 'is', null);
    if (error) console.error('  ERROR:', error.message);
    else console.log(`  Count: ${count}`);
  }

  // ───────────────────────────────────────────────────────
  // Query 2: Unprocessed trades (processed=false)
  // ───────────────────────────────────────────────────────
  hr('2. Count of raw_trades: processed=false');
  {
    const { count, error } = await supabase
      .from('raw_trades')
      .select('*', { count: 'exact', head: true })
      .eq('processed', false);
    if (error) console.error('  ERROR:', error.message);
    else console.log(`  Count: ${count}`);
  }

  // ───────────────────────────────────────────────────────
  // Query 3: Top 10 error messages (group by)
  // ───────────────────────────────────────────────────────
  hr('3. Top 10 error messages among failed trades (processed=true)');
  {
    const { data, error } = await supabase
      .from('raw_trades')
      .select('error_message')
      .eq('processed', true)
      .not('error_message', 'is', null)
      .limit(10000);
    if (error) {
      console.error('  ERROR:', error.message);
    } else {
      const counts = {};
      for (const row of data) {
        const msg = row.error_message;
        counts[msg] = (counts[msg] || 0) + 1;
      }
      const sorted = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);
      for (const [msg, cnt] of sorted) {
        console.log(`  [${cnt}] ${msg}`);
      }
      if (sorted.length === 0) console.log('  (none)');
    }
  }

  hr('3b. Top error messages among UNPROCESSED trades (processed=false, error_message not null)');
  {
    const { data, error } = await supabase
      .from('raw_trades')
      .select('error_message')
      .eq('processed', false)
      .not('error_message', 'is', null)
      .limit(10000);
    if (error) {
      console.error('  ERROR:', error.message);
    } else if (data.length === 0) {
      console.log('  (none)');
    } else {
      const counts = {};
      for (const row of data) {
        const msg = row.error_message;
        counts[msg] = (counts[msg] || 0) + 1;
      }
      const sorted = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);
      for (const [msg, cnt] of sorted) {
        console.log(`  [${cnt}] ${msg}`);
      }
    }
  }

  // ───────────────────────────────────────────────────────
  // Query 4: 5 sample trades for the top error message
  // ───────────────────────────────────────────────────────
  hr('4. Sample trades for the top error message');
  {
    // Get all error messages from both processed and unprocessed
    const { data: allFailed } = await supabase
      .from('raw_trades')
      .select('error_message')
      .not('error_message', 'is', null)
      .limit(10000);

    if (allFailed && allFailed.length > 0) {
      const counts = {};
      for (const row of allFailed) {
        const msg = row.error_message;
        counts[msg] = (counts[msg] || 0) + 1;
      }
      const topMsg = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
      console.log(`  Top error: "${topMsg}"`);

      const { data: samples, error } = await supabase
        .from('raw_trades')
        .select('exec_id, bo_id, client_code, isin, security_code, side, quantity, price, value, error_message')
        .eq('error_message', topMsg)
        .limit(5);

      if (error) console.error('  ERROR:', error.message);
      else {
        for (const s of samples) {
          console.log(`  exec_id=${s.exec_id} | bo_id=${s.bo_id} | client_code=${s.client_code} | isin=${s.isin} | security_code=${s.security_code} | side=${s.side} | qty=${s.quantity} | price=${s.price} | value=${s.value}`);
          console.log(`    error: ${s.error_message}`);
        }
      }
    } else {
      console.log('  No failed trades found.');
    }
  }

  // ───────────────────────────────────────────────────────
  // Query 5: bo_id matching between failed trades and clients
  // ───────────────────────────────────────────────────────
  hr('5. Failed trades bo_id lookup in clients table');
  {
    const { data: failedTrades } = await supabase
      .from('raw_trades')
      .select('bo_id')
      .not('error_message', 'is', null)
      .limit(10000);

    if (failedTrades && failedTrades.length > 0) {
      const uniqueBoIds = [...new Set(failedTrades.map(t => t.bo_id).filter(Boolean))];
      console.log(`  Unique bo_ids in failed trades: ${uniqueBoIds.length}`);

      let matchedCount = 0;
      const unmatchedBoIds = [];

      for (let i = 0; i < uniqueBoIds.length; i += 100) {
        const batch = uniqueBoIds.slice(i, i + 100);
        const { data: clients } = await supabase
          .from('clients')
          .select('bo_id')
          .in('bo_id', batch);
        const foundSet = new Set((clients || []).map(c => c.bo_id));
        for (const boId of batch) {
          if (foundSet.has(boId)) matchedCount++;
          else unmatchedBoIds.push(boId);
        }
      }

      console.log(`  Matched in clients: ${matchedCount}`);
      console.log(`  NOT matched in clients: ${unmatchedBoIds.length}`);
      if (unmatchedBoIds.length > 0) {
        console.log(`  First 20 unmatched bo_ids: ${unmatchedBoIds.slice(0, 20).join(', ')}`);
      }
    } else {
      console.log('  No failed trades found.');
    }
  }

  // ───────────────────────────────────────────────────────
  // Query 6: ISIN matching between failed trades and securities
  // ───────────────────────────────────────────────────────
  hr('6. Failed trades ISIN lookup in securities table');
  {
    const { data: failedTrades } = await supabase
      .from('raw_trades')
      .select('isin')
      .not('error_message', 'is', null)
      .limit(10000);

    if (failedTrades && failedTrades.length > 0) {
      const uniqueIsins = [...new Set(failedTrades.map(t => t.isin).filter(Boolean))];
      console.log(`  Unique ISINs in failed trades: ${uniqueIsins.length}`);

      let matchedCount = 0;
      const unmatchedIsins = [];

      for (let i = 0; i < uniqueIsins.length; i += 100) {
        const batch = uniqueIsins.slice(i, i + 100);
        const { data: secs } = await supabase
          .from('securities')
          .select('isin')
          .in('isin', batch);
        const foundSet = new Set((secs || []).map(s => s.isin));
        for (const isin of batch) {
          if (foundSet.has(isin)) matchedCount++;
          else unmatchedIsins.push(isin);
        }
      }

      console.log(`  Matched in securities: ${matchedCount}`);
      console.log(`  NOT matched in securities: ${unmatchedIsins.length}`);
      if (unmatchedIsins.length > 0) {
        console.log(`  First 20 unmatched ISINs:`);
        for (const isin of unmatchedIsins.slice(0, 20)) {
          console.log(`    ${isin}`);
        }
      }
    } else {
      console.log('  No failed trades found.');
    }
  }

  // ───────────────────────────────────────────────────────
  // Query 7: security_code matching
  // ───────────────────────────────────────────────────────
  hr('7. Failed trades security_code lookup in securities table');
  {
    const { data: failedTrades } = await supabase
      .from('raw_trades')
      .select('security_code')
      .not('error_message', 'is', null)
      .limit(10000);

    if (failedTrades && failedTrades.length > 0) {
      const uniqueCodes = [...new Set(failedTrades.map(t => t.security_code).filter(Boolean))];
      console.log(`  Unique security_codes in failed trades: ${uniqueCodes.length}`);

      let matchedCount = 0;
      const unmatchedCodes = [];

      for (let i = 0; i < uniqueCodes.length; i += 100) {
        const batch = uniqueCodes.slice(i, i + 100);
        const { data: secs } = await supabase
          .from('securities')
          .select('security_code')
          .in('security_code', batch);
        const foundSet = new Set((secs || []).map(s => s.security_code));
        for (const code of batch) {
          if (foundSet.has(code)) matchedCount++;
          else unmatchedCodes.push(code);
        }
      }

      console.log(`  Matched in securities: ${matchedCount}`);
      console.log(`  NOT matched in securities: ${unmatchedCodes.length}`);
      if (unmatchedCodes.length > 0) {
        console.log(`  First 20 unmatched security_codes:`);
        for (const code of unmatchedCodes.slice(0, 20)) {
          console.log(`    ${code}`);
        }
      }
    } else {
      console.log('  No failed trades found.');
    }
  }

  // ───────────────────────────────────────────────────────
  // Query 8: Failed trades where client WAS found
  // ───────────────────────────────────────────────────────
  hr('8. Failed trades where client WAS found (failure on security/other side)');
  {
    const { data: failedTrades } = await supabase
      .from('raw_trades')
      .select('bo_id, client_code, exec_id, isin, security_code, side, quantity, price, value, error_message')
      .not('error_message', 'is', null)
      .limit(10000);

    if (failedTrades && failedTrades.length > 0) {
      const uniqueBoIds = [...new Set(failedTrades.map(t => t.bo_id).filter(Boolean))];
      const clientBoIds = new Set();

      for (let i = 0; i < uniqueBoIds.length; i += 100) {
        const batch = uniqueBoIds.slice(i, i + 100);
        const { data: clients } = await supabase
          .from('clients')
          .select('bo_id')
          .in('bo_id', batch);
        for (const c of (clients || [])) clientBoIds.add(c.bo_id);
      }

      const clientFoundFailed = failedTrades.filter(t => t.bo_id && clientBoIds.has(t.bo_id));
      console.log(`  Failed trades where client was found: ${clientFoundFailed.length}`);

      // Exclude dedup errors
      const nonDupFailed = clientFoundFailed.filter(t =>
        t.error_message !== 'Duplicate exec_id' && t.error_message !== 'Missing exec_id'
      );
      console.log(`  ... excluding Duplicate/Missing exec_id: ${nonDupFailed.length}`);

      if (nonDupFailed.length > 0) {
        console.log(`  5 samples:`);
        for (const s of nonDupFailed.slice(0, 5)) {
          console.log(`  exec_id=${s.exec_id} | bo_id=${s.bo_id} | isin=${s.isin} | security_code=${s.security_code} | side=${s.side} | qty=${s.quantity} | price=${s.price} | value=${s.value}`);
          console.log(`    error: ${s.error_message}`);
        }
      } else {
        console.log('  (all client-found failures are Duplicate/Missing exec_id)');
      }
    } else {
      console.log('  No failed trades found.');
    }
  }

  // ───────────────────────────────────────────────────────
  // Query 9: Summary totals
  // ───────────────────────────────────────────────────────
  hr('9. Summary');
  {
    const { count: total } = await supabase
      .from('raw_trades')
      .select('*', { count: 'exact', head: true });

    const { count: successCount } = await supabase
      .from('raw_trades')
      .select('*', { count: 'exact', head: true })
      .eq('processed', true)
      .is('error_message', null);

    const { count: failedCount } = await supabase
      .from('raw_trades')
      .select('*', { count: 'exact', head: true })
      .eq('processed', true)
      .not('error_message', 'is', null);

    const { count: unprocessedCount } = await supabase
      .from('raw_trades')
      .select('*', { count: 'exact', head: true })
      .eq('processed', false);

    const { count: unprocessedWithError } = await supabase
      .from('raw_trades')
      .select('*', { count: 'exact', head: true })
      .eq('processed', false)
      .not('error_message', 'is', null);

    console.log(`  Total raw_trades:                    ${total}`);
    console.log(`  Processed successfully:              ${successCount}  (processed=true, error_message IS NULL)`);
    console.log(`  Failed (marked processed):           ${failedCount}  (processed=true, error_message NOT NULL)`);
    console.log(`  Unprocessed:                         ${unprocessedCount}  (processed=false)`);
    console.log(`    ... of which have error_message:   ${unprocessedWithError}  (retryable failures)`);
    console.log(`    ... of which clean (no error):     ${(unprocessedCount || 0) - (unprocessedWithError || 0)}  (never attempted)`);
  }

  // ───────────────────────────────────────────────────────
  // Query 10: trade_executions count
  // ───────────────────────────────────────────────────────
  hr('10. Total trade_executions');
  {
    const { count, error } = await supabase
      .from('trade_executions')
      .select('*', { count: 'exact', head: true });
    if (error) console.error('  ERROR:', error.message);
    else console.log(`  Count: ${count}`);
  }

  // ───────────────────────────────────────────────────────
  // Bonus: table counts
  // ───────────────────────────────────────────────────────
  hr('BONUS: Table counts for context');
  {
    const { count: clientCount } = await supabase
      .from('clients')
      .select('*', { count: 'exact', head: true });
    const { count: secCount } = await supabase
      .from('securities')
      .select('*', { count: 'exact', head: true });
    const { count: holdingCount } = await supabase
      .from('holdings')
      .select('*', { count: 'exact', head: true });
    const { count: cashCount } = await supabase
      .from('cash_ledger')
      .select('*', { count: 'exact', head: true });

    console.log(`  clients:        ${clientCount}`);
    console.log(`  securities:     ${secCount}`);
    console.log(`  holdings:       ${holdingCount}`);
    console.log(`  cash_ledger:    ${cashCount}`);
  }

  console.log('\n--- Investigation complete ---');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
