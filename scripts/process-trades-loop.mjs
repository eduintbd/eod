import { MAIN_URL, MAIN_KEY } from './lib/env.mjs';

const FUNC_URL = `${MAIN_URL}/functions/v1/process-trades`;
let totalProcessed = 0;
let totalFailed = 0;
let round = 0;

while (true) {
  round++;
  process.stdout.write(`Round ${round}...`);

  const res = await fetch(FUNC_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${MAIN_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  if (!res.ok) {
    const text = await res.text();
    console.log(` HTTP ${res.status}: ${text.slice(0, 200)}`);
    if (res.status === 504) {
      console.log('  Timeout - retrying...');
      continue;
    }
    break;
  }

  const data = await res.json();
  console.log(` processed: ${data.processed_count}, failed: ${data.failed_count}`);
  totalProcessed += data.processed_count || 0;
  totalFailed += data.failed_count || 0;

  if (data.processed_count === 0) {
    console.log('\nNo more trades to process.');
    break;
  }
}

console.log(`\n=== DONE ===`);
console.log(`Total processed: ${totalProcessed}`);
console.log(`Total failed: ${totalFailed}`);
