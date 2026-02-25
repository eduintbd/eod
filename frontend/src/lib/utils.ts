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

/** Get CSS classes for margin status badge */
export function getMarginStatusColor(status: string): string {
  switch (status) {
    case 'NORMAL':
      return 'bg-success/10 text-success';
    case 'WARNING':
      return 'bg-warning/10 text-warning';
    case 'MARGIN_CALL':
      return 'bg-orange-500/10 text-orange-500';
    case 'FORCE_SELL':
    case 'FORCE_SELL_TRIGGERED':
      return 'bg-destructive/10 text-destructive';
    case 'DEADLINE_BREACH':
      return 'bg-red-700/10 text-red-700';
    case 'EXPOSURE_BREACH':
      return 'bg-purple-500/10 text-purple-500';
    case 'CONCENTRATION_BREACH':
      return 'bg-amber-600/10 text-amber-600';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

/** Format margin ratio as percentage */
export function formatMarginPct(ratio: number | null | undefined): string {
  if (ratio == null) return '—';
  return `${(ratio * 100).toFixed(1)}%`;
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
