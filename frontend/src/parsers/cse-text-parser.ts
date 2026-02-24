import type { RawTrade } from '@/lib/types';

/**
 * Parse CSE pipe-delimited trade file.
 * Format: Branch|SecurityNumCode|SecurityCode|Side|Quantity|Price|ClientCode|||SeqNum|TradeDate|TradeTime|OrderDate|OrderTime|TradeFlag
 * Example: CTG02|11006|CENTRALINS|S|7000|45.00|5919|||43|01/02/2026|10:19:41|01/02/2026|10:19:37|N
 */
export function parseCseText(text: string, fileName: string): RawTrade[] {
  const lines = text.trim().split('\n').filter(line => line.trim().length > 0);
  const trades: RawTrade[] = [];

  for (const line of lines) {
    const fields = line.split('|');
    if (fields.length < 14) continue;

    const [
      branch,
      _secNumCode,
      securityCode,
      side,
      qtyStr,
      priceStr,
      clientCode,
      _empty1,
      _empty2,
      seqNum,
      tradeDateStr,
      tradeTime,
      _orderDate,
      _orderTime,
      tradeFlag,
    ] = fields;

    // Parse date: DD/MM/YYYY -> YYYY-MM-DD
    let tradeDate: string | null = null;
    if (tradeDateStr) {
      const parts = tradeDateStr.trim().split('/');
      if (parts.length === 3) {
        tradeDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
      }
    }

    const quantity = parseInt(qtyStr, 10);
    const price = parseFloat(priceStr);
    const value = quantity * price;

    // Determine board from trade flag
    const board = tradeFlag?.trim() === 'B' ? 'BLOCK' : 'PUBLIC';

    const rawData: Record<string, string> = {};
    fields.forEach((f, i) => { rawData[`field_${i}`] = f; });

    trades.push({
      source: 'CSE',
      file_name: fileName,
      action: 'EXEC',
      status: 'FILL', // CSE file only contains executed trades
      order_id: null,
      ref_order_id: null,
      side: (side?.trim() as 'B' | 'S') || null,
      bo_id: null,
      client_code: clientCode?.trim() || null,
      isin: null, // CSE file doesn't include ISIN, needs lookup by security_code
      security_code: securityCode?.trim() || null,
      board,
      trade_date: tradeDate,
      trade_time: tradeTime?.trim() || null,
      quantity: isNaN(quantity) ? null : quantity,
      price: isNaN(price) ? null : price,
      value: isNaN(value) ? null : value,
      exec_id: seqNum?.trim() ? `CSE-${seqNum.trim()}` : null,
      session: null,
      fill_type: 'FILL',
      category: null,
      asset_class: null,
      compulsory_spot: false,
      trader_dealer_id: branch?.trim() || null,
      owner_dealer_id: null,
      raw_data: rawData,
      processed: false,
    });
  }

  return trades;
}
