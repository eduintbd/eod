/**
 * Compute settlement date based on security category and trade characteristics.
 *
 * Rules:
 * - Category A, B, G, N: T+2 business days
 * - Category Z: T+3 business days (buy)
 * - Spot trades (CompulsorySpot): T+0 for sell, T+1 for buy
 */
export function computeSettlementDate(
  tradeDate: string,
  category: string | null,
  side: 'BUY' | 'SELL',
  isSpot: boolean,
): string {
  const date = new Date(tradeDate + 'T00:00:00');

  if (isSpot) {
    const days = side === 'SELL' ? 0 : 1;
    return addBusinessDays(date, days);
  }

  if (category === 'Z') {
    return addBusinessDays(date, 3);
  }

  // Default: T+2 for Category A, B, G, N and others
  return addBusinessDays(date, 2);
}

function addBusinessDays(start: Date, days: number): string {
  const result = new Date(start);
  let added = 0;

  while (added < days) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();
    // Skip weekends (Friday=5 and Saturday=6 are weekends in Bangladesh)
    if (day !== 5 && day !== 6) {
      added++;
    }
  }

  return result.toISOString().split('T')[0];
}
