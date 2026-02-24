import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  'https://zuupegtizrvbnsliuddu.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp1dXBlZ3RpenJ2Ym5zbGl1ZGR1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTg3ODE1NCwiZXhwIjoyMDg3NDU0MTU0fQ.fE4D9Y0mFGzY6NT2aqnA9MLQJqHVQRB5VGo6II0zKx0'
);

const BATCH = 300;

async function main() {
  // 1. Delete non-actionable unprocessed raw_trades
  console.log('Deleting non-actionable unprocessed raw_trades...');
  let deleted = 0;
  while (true) {
    const { data: batch } = await sb.from('raw_trades').select('id')
      .eq('processed', false).limit(BATCH);
    if (!batch || batch.length === 0) break;
    const ids = batch.map(r => r.id);
    const { error, count } = await sb.from('raw_trades').delete({ count: 'exact' }).in('id', ids);
    if (error) { console.log('Error: ' + error.message); break; }
    deleted += count;
    process.stdout.write('  Deleted ' + deleted + '...\r');
  }
  console.log('  Deleted unprocessed: ' + deleted + '          ');

  // 2. Delete processed-with-error duplicates
  const { count: dupCount } = await sb.from('raw_trades').delete({ count: 'exact' })
    .eq('processed', true).not('error_message', 'is', null);
  console.log('  Deleted duplicates (processed+error): ' + (dupCount ?? 0));

  // 3. Final state
  const { count: total } = await sb.from('raw_trades').select('id', { count: 'exact', head: true });
  const { count: processed } = await sb.from('raw_trades').select('id', { count: 'exact', head: true })
    .eq('processed', true).is('error_message', null);
  console.log('\nFinal: ' + total + ' raw_trades remaining (all clean processed: ' + processed + ')');
}

main().catch(console.error);
