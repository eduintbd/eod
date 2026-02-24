import type { RawTrade } from '@/lib/types';

/**
 * Parse DSE XML trade file in the browser.
 * Format: <Trades><Detail Action="..." Status="..." .../></Trades>
 * Files can be 30MB+ with 70K+ Detail elements.
 *
 * Uses regex-based extraction instead of DOMParser for performance —
 * DOMParser loads the entire DOM into memory which can crash on 30MB+ files.
 */

// Regex to match each <Detail ... /> element
const DETAIL_RE = /<Detail\s([^>]+)\/>/g;
// Regex to extract attribute name="value" pairs
const ATTR_RE = /(\w+)="([^"]*)"/g;

function parseAttributes(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  let m: RegExpExecArray | null;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(attrString)) !== null) {
    attrs[m[1]] = m[2];
  }
  return attrs;
}

export function parseDseXml(xmlText: string, fileName: string): RawTrade[] {
  const trades: RawTrade[] = [];
  let match: RegExpExecArray | null;

  DETAIL_RE.lastIndex = 0;
  while ((match = DETAIL_RE.exec(xmlText)) !== null) {
    const attrs = parseAttributes(match[1]);

    const val = (name: string): string | null => {
      const v = attrs[name];
      return v === undefined || v === '-' || v === '' ? null : v;
    };

    const dateStr = val('Date');
    let tradeDate: string | null = null;
    if (dateStr && dateStr.length === 8) {
      tradeDate = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
    }

    const quantity = parseInt(val('Quantity') || '0', 10);
    const price = parseFloat(val('Price') || '0');
    const value = parseFloat(val('Value') || '0');

    trades.push({
      source: 'DSE',
      file_name: fileName,
      action: val('Action'),
      status: val('Status'),
      order_id: val('OrderID'),
      ref_order_id: val('RefOrderID'),
      side: (val('Side') as 'B' | 'S') || null,
      bo_id: val('BOID'),
      client_code: val('ClientCode'),
      isin: val('ISIN'),
      security_code: val('SecurityCode'),
      board: val('Board'),
      trade_date: tradeDate,
      trade_time: val('Time'),
      quantity: isNaN(quantity) ? null : quantity,
      price: isNaN(price) ? null : price,
      value: isNaN(value) ? null : value,
      exec_id: val('ExecID'),
      session: val('Session'),
      fill_type: val('FillType'),
      category: val('Category'),
      asset_class: val('AssetClass'),
      compulsory_spot: val('CompulsorySpot') === 'Y',
      trader_dealer_id: val('TraderDealerID'),
      owner_dealer_id: val('OwnerDealerID'),
      raw_data: attrs,
      processed: false,
    });
  }

  return trades;
}
