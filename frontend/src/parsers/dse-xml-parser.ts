import type { RawTrade } from '@/lib/types';

/**
 * Parse DSE XML trade file in the browser.
 * Format: <Trades><Detail Action="..." Status="..." .../></Trades>
 * Files can be 30MB+ with 70K+ Detail elements.
 */
export function parseDseXml(xmlText: string, fileName: string): RawTrade[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'text/xml');

  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error(`XML parse error: ${parseError.textContent}`);
  }

  const details = doc.querySelectorAll('Detail');
  const trades: RawTrade[] = [];

  for (const el of details) {
    const attr = (name: string): string | null => {
      const v = el.getAttribute(name);
      return v === '-' || v === '' ? null : v;
    };

    const dateStr = attr('Date');
    let tradeDate: string | null = null;
    if (dateStr && dateStr.length === 8) {
      // YYYYMMDD -> YYYY-MM-DD
      tradeDate = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
    }

    const quantity = parseInt(attr('Quantity') || '0', 10);
    const price = parseFloat(attr('Price') || '0');
    const value = parseFloat(attr('Value') || '0');

    // Build raw_data from all attributes
    const rawData: Record<string, string> = {};
    for (const a of el.attributes) {
      rawData[a.name] = a.value;
    }

    trades.push({
      source: 'DSE',
      file_name: fileName,
      action: attr('Action'),
      status: attr('Status'),
      order_id: attr('OrderID'),
      ref_order_id: attr('RefOrderID'),
      side: (attr('Side') as 'B' | 'S') || null,
      bo_id: attr('BOID'),
      client_code: attr('ClientCode'),
      isin: attr('ISIN'),
      security_code: attr('SecurityCode'),
      board: attr('Board'),
      trade_date: tradeDate,
      trade_time: attr('Time'),
      quantity: isNaN(quantity) ? null : quantity,
      price: isNaN(price) ? null : price,
      value: isNaN(value) ? null : value,
      exec_id: attr('ExecID'),
      session: attr('Session'),
      fill_type: attr('FillType'),
      category: attr('Category'),
      asset_class: attr('AssetClass'),
      compulsory_spot: attr('CompulsorySpot') === 'Y',
      trader_dealer_id: attr('TraderDealerID'),
      owner_dealer_id: attr('OwnerDealerID'),
      raw_data: rawData,
      processed: false,
    });
  }

  return trades;
}
