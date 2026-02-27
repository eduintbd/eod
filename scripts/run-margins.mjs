const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp1dXBlZ3RpenJ2Ym5zbGl1ZGR1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTg3ODE1NCwiZXhwIjoyMDg3NDU0MTU0fQ.fE4D9Y0mFGzY6NT2aqnA9MLQJqHVQRB5VGo6II0zKx0';
const URL = 'https://zuupegtizrvbnsliuddu.supabase.co/functions/v1/calculate-margins';

let offset = 0;
let totalProcessed = 0;
const statusTotals = {};
let totalAlerts = 0;

while (true) {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ offset })
  });
  const data = await res.json();
  totalProcessed += data.clients_processed;
  totalAlerts += data.alerts_generated || 0;
  for (const [s, c] of Object.entries(data.status_counts || {})) {
    statusTotals[s] = (statusTotals[s] || 0) + c;
  }
  console.log(`Batch offset=${offset}: ${data.clients_processed} clients, done=${data.done}`);
  if (data.done || data.clients_processed === 0) break;
  offset += data.batch_size || 200;
}
console.log(`\nTotal: ${totalProcessed} clients processed`);
console.log('Status:', JSON.stringify(statusTotals));
console.log('Alerts:', totalAlerts);
