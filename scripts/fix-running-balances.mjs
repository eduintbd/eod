/**
 * Fix running_balance on cash_ledger for ALL clients.
 * The process-trades-local.mjs had a pagination bug that caused running_balance
 * to start from 0 instead of the opening balance for many clients.
 *
 * This script recalculates running_balance sequentially for each client.
 */
import { createClient } from '@supabase/supabase-js';
import { MAIN_URL, MAIN_KEY } from './lib/env.mjs';

const db = createClient(MAIN_URL, MAIN_KEY, { auth: { persistSession: false } });
const round = v => Math.round(v * 100) / 100;

// Get all distinct client_ids from cash_ledger
console.log('Loading all client IDs from cash_ledger...');
let clientIds = new Set();
let offset = 0;
while (true) {
  const { data: batch } = await db.from('cash_ledger')
    .select('client_id')
    .order('client_id')
    .range(offset, offset + 999);
  if (!batch || batch.length === 0) break;
  for (const r of batch) clientIds.add(r.client_id);
  offset += batch.length;
  if (batch.length < 1000) break;
}
const uniqueClients = [...clientIds];
console.log(`Found ${uniqueClients.length} clients with cash_ledger entries`);

let fixed = 0, alreadyCorrect = 0, errors = 0;

for (let ci = 0; ci < uniqueClients.length; ci++) {
  const clientId = uniqueClients[ci];

  // Load ALL entries for this client ordered by id
  let entries = [];
  let eOffset = 0;
  while (true) {
    const { data: batch } = await db.from('cash_ledger')
      .select('id, amount, running_balance')
      .eq('client_id', clientId)
      .order('id', { ascending: true })
      .range(eOffset, eOffset + 999);
    if (!batch || batch.length === 0) break;
    entries.push(...batch);
    eOffset += batch.length;
    if (batch.length < 1000) break;
  }

  if (entries.length === 0) continue;

  // Recalculate running balance
  let balance = 0;
  let needsUpdate = false;
  const updates = [];

  for (const e of entries) {
    balance = round(balance + Number(e.amount));
    if (Math.abs(balance - Number(e.running_balance)) > 0.01) {
      needsUpdate = true;
      updates.push({ id: e.id, running_balance: balance });
    }
  }

  if (!needsUpdate) {
    alreadyCorrect++;
  } else {
    // Batch update
    for (let i = 0; i < updates.length; i += 50) {
      const batch = updates.slice(i, i + 50);
      for (const u of batch) {
        const { error } = await db.from('cash_ledger')
          .update({ running_balance: u.running_balance })
          .eq('id', u.id);
        if (error) {
          console.log(`  ERROR updating id=${u.id}: ${error.message}`);
          errors++;
        }
      }
    }
    fixed++;
  }

  if ((ci + 1) % 100 === 0 || ci === uniqueClients.length - 1) {
    process.stdout.write(`  ${ci + 1}/${uniqueClients.length} (${fixed} fixed, ${alreadyCorrect} ok, ${errors} err)\r`);
  }
}

console.log(`\n\n=== DONE ===`);
console.log(`Clients checked: ${uniqueClients.length}`);
console.log(`Already correct: ${alreadyCorrect}`);
console.log(`Fixed: ${fixed}`);
console.log(`Errors: ${errors}`);

// Verify client 400
const { data: verify } = await db.from('clients')
  .select('client_id')
  .eq('client_code', '400')
  .single();
if (verify) {
  const { data: latest } = await db.from('cash_ledger')
    .select('running_balance')
    .eq('client_id', verify.client_id)
    .order('id', { ascending: false })
    .limit(1)
    .single();
  console.log(`\nClient 400 final running_balance: ${latest?.running_balance}`);
}
