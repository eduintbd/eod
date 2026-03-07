import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../../.env');

const envContent = readFileSync(envPath, 'utf-8');
for (const line of envContent.split('\n')) {
  const m = line.match(/^(\w+)=["']?(.+?)["']?\s*$/);
  if (m) process.env[m[1]] = m[2];
}

export const MAIN_URL = process.env.VITE_SUPABASE_URL;
export const MAIN_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
export const SOURCE_URL = process.env.VITE_MARKET_DATA_URL;
export const SOURCE_KEY = process.env.MARKET_DATA_SERVICE_ROLE_KEY || process.env.VITE_MARKET_DATA_ANON_KEY;
