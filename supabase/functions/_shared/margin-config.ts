// BSEC Margin Rules 2025 — configurable parameters loaded from margin_config table

export interface MarginConfig {
  market_pe_threshold: number;
  market_pe_cap_active: boolean;
  normal_threshold: number;
  force_sell_threshold: number;
  margin_call_deadline_days: number;
  single_client_limit_pct: number;
  single_client_limit_max: number;
  single_security_limit_pct: number;
  core_capital_net_worth: number;
  min_ffmc_mn: number;
  max_trailing_pe: number;
  sectoral_pe_multiplier: number;
  portfolio_tier1_min: number;
  portfolio_tier1_max: number;
  portfolio_tier1_ratio: number;
  portfolio_tier2_ratio: number;
}

const DEFAULTS: MarginConfig = {
  market_pe_threshold: 20,
  market_pe_cap_active: false,
  normal_threshold: 0.75,
  force_sell_threshold: 0.50,
  margin_call_deadline_days: 3,
  single_client_limit_pct: 0.15,
  single_client_limit_max: 100000000,
  single_security_limit_pct: 0.15,
  core_capital_net_worth: 0,
  min_ffmc_mn: 500,
  max_trailing_pe: 30,
  sectoral_pe_multiplier: 2,
  portfolio_tier1_min: 500000,
  portfolio_tier1_max: 1000000,
  portfolio_tier1_ratio: 0.667,
  portfolio_tier2_ratio: 0.50,
};

export async function loadMarginConfig(
  supabase: { from: (table: string) => unknown },
): Promise<MarginConfig> {
  // deno-lint-ignore no-explicit-any
  const sb = supabase as any;
  const { data } = await sb
    .from('margin_config')
    .select('parameter_name, parameter_value')
    .eq('is_active', true)
    .is('effective_to', null);

  const params = data || [];
  const get = (name: string): number | undefined => {
    const row = params.find((p: { parameter_name: string }) => p.parameter_name === name);
    return row ? Number(row.parameter_value) : undefined;
  };

  return {
    market_pe_threshold: get('market_pe_threshold') ?? DEFAULTS.market_pe_threshold,
    market_pe_cap_active: (get('market_pe_cap_active') ?? 0) === 1,
    normal_threshold: get('normal_threshold') ?? DEFAULTS.normal_threshold,
    force_sell_threshold: get('force_sell_threshold') ?? DEFAULTS.force_sell_threshold,
    margin_call_deadline_days: get('margin_call_deadline_days') ?? DEFAULTS.margin_call_deadline_days,
    single_client_limit_pct: get('single_client_limit_pct') ?? DEFAULTS.single_client_limit_pct,
    single_client_limit_max: get('single_client_limit_max') ?? DEFAULTS.single_client_limit_max,
    single_security_limit_pct: get('single_security_limit_pct') ?? DEFAULTS.single_security_limit_pct,
    core_capital_net_worth: get('core_capital_net_worth') ?? DEFAULTS.core_capital_net_worth,
    min_ffmc_mn: get('min_ffmc_mn') ?? DEFAULTS.min_ffmc_mn,
    max_trailing_pe: get('max_trailing_pe') ?? DEFAULTS.max_trailing_pe,
    sectoral_pe_multiplier: get('sectoral_pe_multiplier') ?? DEFAULTS.sectoral_pe_multiplier,
    portfolio_tier1_min: get('portfolio_tier1_min') ?? DEFAULTS.portfolio_tier1_min,
    portfolio_tier1_max: get('portfolio_tier1_max') ?? DEFAULTS.portfolio_tier1_max,
    portfolio_tier1_ratio: get('portfolio_tier1_ratio') ?? DEFAULTS.portfolio_tier1_ratio,
    portfolio_tier2_ratio: get('portfolio_tier2_ratio') ?? DEFAULTS.portfolio_tier2_ratio,
  };
}
