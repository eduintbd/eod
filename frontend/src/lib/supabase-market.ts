import { createClient } from '@supabase/supabase-js';

/**
 * Read-only Supabase client for the source project (ucb csm).
 * Connects to the dse_market_data schema for DSE market prices,
 * stock fundamentals, and historical price data.
 *
 * IMPORTANT: This client is READ-ONLY. Never use it for writes.
 */

const marketDataUrl = import.meta.env.VITE_MARKET_DATA_URL as string;
const marketDataAnonKey = import.meta.env.VITE_MARKET_DATA_ANON_KEY as string;

if (!marketDataUrl || !marketDataAnonKey) {
  console.warn(
    'Missing VITE_MARKET_DATA_URL or VITE_MARKET_DATA_ANON_KEY environment variables. ' +
    'Market data features will not work.'
  );
}

export const marketDb = createClient(
  marketDataUrl || 'http://localhost:54321',
  marketDataAnonKey || 'placeholder',
  {
    db: { schema: 'dse_market_data' },
    auth: { persistSession: false },
  }
);
