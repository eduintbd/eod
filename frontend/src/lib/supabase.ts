import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY environment variables. ' +
    'Create a .env file in the frontend/ directory with these values.'
  );
}

export const supabase = createClient(
  supabaseUrl || 'http://localhost:54321',
  supabaseAnonKey || 'placeholder'
);

/**
 * Admin client that bypasses RLS by not carrying any auth session.
 * Uses a separate storage key so it never picks up the logged-in
 * user's session from the main client. Use for admin operations like
 * syncing prices, enriching securities, classifying marginability.
 */
export const supabaseAdmin = createClient(
  supabaseUrl || 'http://localhost:54321',
  supabaseAnonKey || 'placeholder',
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      storageKey: 'supabase-admin-no-session',
    },
  }
);
