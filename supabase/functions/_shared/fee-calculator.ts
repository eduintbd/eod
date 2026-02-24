interface FeeSchedule {
  commission_rate: number;  // e.g. 0.003 for 0.3%
  exchange_fee_rate: number; // e.g. 0.0003 for 0.03%
  cdbl_fee_rate: number;    // e.g. 0.000175 for 0.0175%
  cdbl_min: number;         // e.g. 5 BDT
  ait_rate: number;         // e.g. 0.0005 for 0.05%
}

export interface FeeBreakdown {
  commission: number;
  exchange_fee: number;
  cdbl_fee: number;
  ait: number;
  total_fees: number;
  net_value: number; // For BUY: value + fees; For SELL: value - fees
}

export function calculateFees(
  tradeValue: number,
  side: 'BUY' | 'SELL',
  schedule: FeeSchedule,
): FeeBreakdown {
  const commission = tradeValue * schedule.commission_rate;
  const exchange_fee = tradeValue * schedule.exchange_fee_rate;
  const cdbl_fee = Math.max(tradeValue * schedule.cdbl_fee_rate, schedule.cdbl_min);
  const ait = tradeValue * schedule.ait_rate;
  const total_fees = commission + exchange_fee + cdbl_fee + ait;

  const net_value = side === 'BUY'
    ? tradeValue + total_fees
    : tradeValue - total_fees;

  return {
    commission: Math.round(commission * 100) / 100,
    exchange_fee: Math.round(exchange_fee * 100) / 100,
    cdbl_fee: Math.round(cdbl_fee * 100) / 100,
    ait: Math.round(ait * 100) / 100,
    total_fees: Math.round(total_fees * 100) / 100,
    net_value: Math.round(net_value * 100) / 100,
  };
}

export async function loadFeeSchedule(
  supabase: { from: (table: string) => unknown },
): Promise<FeeSchedule> {
  const sb = supabase as { from: (t: string) => { select: (s: string) => { eq: (k: string, v: unknown) => { eq: (k: string, v: unknown) => Promise<{ data: Array<{ fee_type: string; rate: number; min_amount: number }> }> } } } };
  const { data } = await sb
    .from('fee_schedule')
    .select('fee_type, rate, min_amount')
    .eq('is_active', true)
    .eq('effective_to', null);

  const fees = data || [];
  const get = (type: string) => fees.find(f => f.fee_type === type);

  return {
    commission_rate: get('BROKERAGE_COMMISSION')?.rate ?? 0.003,
    exchange_fee_rate: get('EXCHANGE_FEE')?.rate ?? 0.0003,
    cdbl_fee_rate: get('CDBL_FEE')?.rate ?? 0.000175,
    cdbl_min: get('CDBL_FEE')?.min_amount ?? 5,
    ait_rate: get('AIT')?.rate ?? 0.0005,
  };
}
