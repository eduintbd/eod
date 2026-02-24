import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format a number as BDT currency */
export function formatBDT(amount: number | null | undefined): string {
  if (amount == null) return '—';
  return new Intl.NumberFormat('en-BD', {
    style: 'currency',
    currency: 'BDT',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** Format a number with commas */
export function formatNumber(n: number | null | undefined, decimals = 2): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-BD', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

/** Format percentage */
export function formatPct(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

/** Parse a "number" string that may have commas and parens for negatives */
export function parseFormattedNumber(s: string | null | undefined): number {
  if (!s || s.trim() === '' || s.trim() === '#N/A') return 0;
  let cleaned = s.trim();
  // Handle negative in parens: " (19,552.97)" -> -19552.97
  const isNeg = cleaned.includes('(') && cleaned.includes(')');
  cleaned = cleaned.replace(/[()]/g, '').replace(/,/g, '').trim();
  const num = parseFloat(cleaned);
  if (isNaN(num)) return 0;
  return isNeg ? -num : num;
}
