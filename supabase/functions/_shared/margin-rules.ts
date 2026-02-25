// BSEC Margin Rules 2025 — status determination and dynamic ratio logic
//
// Section 9(1): Maintenance margin — equity >= 75% of margin financing,
//               portfolio value >= 175% of margin financing
// Section 9(4): Force sell — equity <= 50% of margin financing
// Section 7(5): Market P/E > 20 → cap ratio at 1:0.5
// Section 7(6): Dynamic ratios by portfolio size

import type { MarginConfig } from './margin-config.ts';

// Keep constants exported for backward compatibility / defaults
export const NORMAL_THRESHOLD = 0.75;
export const FORCE_SELL_THRESHOLD = 0.50;

export type MarginStatus = 'NORMAL' | 'MARGIN_CALL' | 'FORCE_SELL';

/**
 * Determine margin status based on equity ratio and configurable thresholds.
 */
export function determineMarginStatus(
  equityRatio: number,
  normalThreshold: number = NORMAL_THRESHOLD,
  forceSellThreshold: number = FORCE_SELL_THRESHOLD,
): MarginStatus {
  if (equityRatio >= normalThreshold) return 'NORMAL';
  if (equityRatio <= forceSellThreshold) return 'FORCE_SELL';
  return 'MARGIN_CALL';
}

export interface AppliedRatio {
  ratio: string;                   // Display string: "1:1", "1:0.5", "N/A"
  effectiveEquityThreshold: number; // Min equity/portfolio ratio for this tier
}

/**
 * Determine which equity:margin ratio applies based on portfolio size and market P/E cap.
 *
 * Section 7(5): If overall market P/E > 20, ratio caps at 1:0.5 (equity 66.7%)
 * Section 7(6)(a): Portfolio 5-10 lakh → 1:0.5
 * Section 7(6)(b): Portfolio 10+ lakh → 1:1
 */
export function determineAppliedRatio(
  marginablePortfolioValue: number,
  config: MarginConfig,
): AppliedRatio {
  // Market P/E cap overrides everything (Section 7(5))
  if (config.market_pe_cap_active) {
    return { ratio: '1:0.5', effectiveEquityThreshold: config.portfolio_tier1_ratio };
  }

  // Dynamic ratio by portfolio size (Section 7(6))
  if (marginablePortfolioValue >= config.portfolio_tier1_max) {
    // 10L+ → 1:1 (equity covers 50% of portfolio)
    return { ratio: '1:1', effectiveEquityThreshold: config.portfolio_tier2_ratio };
  }

  if (marginablePortfolioValue >= config.portfolio_tier1_min) {
    // 5-10L → 1:0.5 (equity covers 66.7% of portfolio)
    return { ratio: '1:0.5', effectiveEquityThreshold: config.portfolio_tier1_ratio };
  }

  // Below minimum tier — no margin financing should be available
  return { ratio: 'N/A', effectiveEquityThreshold: 1.0 };
}
