/**
 * Process all remaining unprocessed trades by calling the process-trades Edge Function in a loop.
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://zuupegtizrvbnsliuddu.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp1dXBlZ3RpenJ2Ym5zbGl1ZGR1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTg3ODE1NCwiZXhwIjoyMDg3NDU0MTU0fQ.fE4D9Y0mFGzY6NT2aqnA9MLQJqHVQRB5VGo6II0zKx0';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function main() {
  console.log('=== Processing Remaining Trades ===\n');

  // Check how many remain
  const { count: remaining } = await supabase
    .from('raw_trades')
    .select('id', { count: 'exact', head: true })
    .eq('processed', false)
    .in('status', ['FILL', 'PF'])
    .gt('quantity', 0);

  console.log(`Unprocessed actionable trades: ${remaining}\n`);

  if (remaining === 0) {
    console.log('Nothing to process!');
    return;
  }

  let totalProcessed = 0;
  let totalFailed = 0;
  let batchNum = 0;

  while (true) {
    batchNum++;
    process.stdout.write(`Batch ${batchNum}...`);

    const { data, error } = await supabase.functions.invoke('process-trades', {
      body: {},
    });

    if (error) {
      console.log(` ERROR: ${error.message}`);
      if (data?.error) console.log(`  Detail: ${data.error}`);
      // If we already processed some, don't give up — could be a transient error
      if (totalProcessed > 0 && batchNum < 100) {
        console.log('  Retrying...');
        continue;
      }
      break;
    }

    const batchProcessed = data?.processed_count ?? 0;
    const batchFailed = data?.failed_count ?? 0;
    const totalRaw = data?.total_raw ?? 0;
    totalProcessed += batchProcessed;
    totalFailed += batchFailed;

    console.log(` processed: ${batchProcessed}, failed: ${batchFailed}, batch_raw: ${totalRaw} (cumulative: ${totalProcessed} processed, ${totalFailed} failed)`);

    // Done if no more trades
    if (batchProcessed === 0 && batchFailed === 0) break;
    if (totalRaw < 200) break;

    // Safety: don't loop forever
    if (batchNum >= 100) {
      console.log('\nStopped after 100 batches (safety limit).');
      break;
    }
  }

  console.log(`\n=== Done ===`);
  console.log(`Total processed: ${totalProcessed}`);
  console.log(`Total failed: ${totalFailed}`);

  // Final check
  const { count: stillRemaining } = await supabase
    .from('raw_trades')
    .select('id', { count: 'exact', head: true })
    .eq('processed', false)
    .in('status', ['FILL', 'PF'])
    .gt('quantity', 0);

  const { count: execCount } = await supabase
    .from('trade_executions')
    .select('exec_id', { count: 'exact', head: true });

  console.log(`\nStill unprocessed: ${stillRemaining}`);
  console.log(`Total trade_executions: ${execCount}`);
}

main().catch(console.error);
