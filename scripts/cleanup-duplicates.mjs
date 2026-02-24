/**
 * Clean up duplicate raw_trades and stale audit records.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://zuupegtizrvbnsliuddu.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp1dXBlZ3RpenJ2Ym5zbGl1ZGR1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTg3ODE1NCwiZXhwIjoyMDg3NDU0MTU0fQ.fE4D9Y0mFGzY6NT2aqnA9MLQJqHVQRB5VGo6II0zKx0';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const BATCH = 300;

async function main() {
  console.log('=== Cleanup: Duplicate Raw Trades & Stale Audit Records ===\n');

  // Step 1: Delete stale PROCESSING audit record (id=6)
  console.log('Step 1: Deleting stale import_audit record (id=6)...');
  const { error: auditErr, count: auditCount } = await supabase
    .from('import_audit')
    .delete({ count: 'exact' })
    .eq('id', 6);
  console.log(`  Deleted: ${auditCount ?? 0}${auditErr ? ` (error: ${auditErr.message})` : ''}`);

  // Step 2: Find duplicate raw_trades (failed with duplicate error, processed=true)
  console.log('\nStep 2: Counting failed duplicate raw_trades...');
  const { count: failedDupCount } = await supabase
    .from('raw_trades')
    .select('id', { count: 'exact', head: true })
    .eq('processed', true)
    .not('error_message', 'is', null);
  console.log(`  Failed trades with error_message: ${failedDupCount}`);

  // Step 3: Delete them in batches
  console.log('\nStep 3: Deleting failed duplicate raw_trades...');
  let totalDeleted = 0;
  while (true) {
    // Fetch a batch of IDs to delete
    const { data: batch, error: fetchErr } = await supabase
      .from('raw_trades')
      .select('id')
      .eq('processed', true)
      .not('error_message', 'is', null)
      .limit(BATCH);

    if (fetchErr) {
      console.log(`  Fetch error: ${fetchErr.message}`);
      break;
    }
    if (!batch || batch.length === 0) break;

    const ids = batch.map(r => r.id);
    const { error: delErr, count } = await supabase
      .from('raw_trades')
      .delete({ count: 'exact' })
      .in('id', ids);

    if (delErr) {
      console.log(`  Delete error: ${delErr.message}`);
      break;
    }
    totalDeleted += count ?? 0;
    process.stdout.write(`  Deleted ${totalDeleted}...\r`);
  }
  console.log(`  Deleted total: ${totalDeleted}                `);

  // Step 4: Also remove non-actionable raw_trades (ACK status, not FILL/PF)
  // These are informational and will never be processed
  console.log('\nStep 4: Counting non-actionable raw_trades (not FILL/PF or qty=0)...');
  const { count: nonActionable } = await supabase
    .from('raw_trades')
    .select('id', { count: 'exact', head: true })
    .eq('processed', false)
    .or('status.not.in.(FILL,PF),quantity.lte.0,quantity.is.null');

  console.log(`  Non-actionable unprocessed: ${nonActionable}`);

  // Step 5: Delete non-actionable trades in batches
  if (nonActionable && nonActionable > 0) {
    console.log('\nStep 5: Deleting non-actionable raw_trades...');
    let nonActDeleted = 0;
    while (true) {
      const { data: batch, error: fetchErr } = await supabase
        .from('raw_trades')
        .select('id')
        .eq('processed', false)
        .or('status.not.in.(FILL,PF),quantity.lte.0,quantity.is.null')
        .limit(BATCH);

      if (fetchErr) {
        console.log(`  Fetch error: ${fetchErr.message}`);
        break;
      }
      if (!batch || batch.length === 0) break;

      const ids = batch.map(r => r.id);
      const { error: delErr, count } = await supabase
        .from('raw_trades')
        .delete({ count: 'exact' })
        .in('id', ids);

      if (delErr) {
        console.log(`  Delete error: ${delErr.message}`);
        break;
      }
      nonActDeleted += count ?? 0;
      process.stdout.write(`  Deleted ${nonActDeleted}...\r`);
    }
    console.log(`  Deleted total: ${nonActDeleted}                `);
  }

  // Step 6: Final state
  console.log('\n=== Final State ===');
  const { count: rawRemaining } = await supabase
    .from('raw_trades')
    .select('id', { count: 'exact', head: true });

  const { count: rawProcessed } = await supabase
    .from('raw_trades')
    .select('id', { count: 'exact', head: true })
    .eq('processed', true)
    .is('error_message', null);

  const { count: rawUnprocessed } = await supabase
    .from('raw_trades')
    .select('id', { count: 'exact', head: true })
    .eq('processed', false);

  const { count: rawWithErrors } = await supabase
    .from('raw_trades')
    .select('id', { count: 'exact', head: true })
    .not('error_message', 'is', null);

  const { count: execCount } = await supabase
    .from('trade_executions')
    .select('exec_id', { count: 'exact', head: true });

  const { count: auditRemaining } = await supabase
    .from('import_audit')
    .select('id', { count: 'exact', head: true });

  console.log(`  raw_trades remaining: ${rawRemaining}`);
  console.log(`    processed (clean): ${rawProcessed}`);
  console.log(`    unprocessed: ${rawUnprocessed}`);
  console.log(`    with errors: ${rawWithErrors}`);
  console.log(`  trade_executions: ${execCount}`);
  console.log(`  import_audit records: ${auditRemaining}`);

  console.log('\nDone!');
}

main().catch(console.error);
