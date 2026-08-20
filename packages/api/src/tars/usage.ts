import { tarsFetch } from './client';

/** The two providers whose admin API pwc_tars can bill against. */
export type TarsUsageProvider = 'openai' | 'anthropic';

export interface TarsUsagePeriod {
  start_date: string;
  end_date: string;
}

export interface TarsUsageModelStat {
  input_tokens: number;
  output_tokens: number;
  requests: number;
}

export interface TarsUsageCompletions {
  total_input_tokens: number;
  total_output_tokens: number;
  total_requests: number;
  by_model: Record<string, TarsUsageModelStat>;
}

export interface TarsUsageCosts {
  total: number;
  currency: string;
  by_line_item: Record<string, number>;
}

export interface TarsUsageDailyCost {
  date: string;
  cost: number;
}

export interface TarsUsageBilling {
  budget: number | null;
  usage_this_month: {
    total_cost: number;
    currency: string;
    period: { start: string; end: string };
  } | null;
  remaining_balance: number | null;
}

/**
 * One month of provider spend. Both pwc_tars endpoints answer this same shape —
 * the Anthropic one is written to mirror the OpenAI one — so the UI is provider
 * agnostic below the picker.
 */
export interface TarsProviderUsage {
  period: TarsUsagePeriod;
  completions: TarsUsageCompletions;
  costs: TarsUsageCosts;
  daily_costs: TarsUsageDailyCost[];
  billing: TarsUsageBilling;
}

export interface TarsUsageQuery {
  month?: string;
  budget?: number;
}

const USAGE_PATHS: Record<TarsUsageProvider, string> = {
  openai: '/api/settings/openai/get_usage',
  anthropic: '/api/settings/anthropic/get_usage',
};

/**
 * pwc_tars fans this out to the provider's admin API, one page per day bucket,
 * so it routinely outruns the shared 15s default.
 */
const USAGE_TIMEOUT_MS = 60_000;

/**
 * Spend and token counts for one month. The billing key is not passed from here:
 * pwc_tars reads the provider's price-query key out of `sys_config` itself, so
 * the browser never handles it.
 */
export async function fetchTarsProviderUsage(
  provider: TarsUsageProvider,
  query: TarsUsageQuery,
  baseUrl?: string,
): Promise<TarsProviderUsage> {
  return tarsFetch<TarsProviderUsage>(USAGE_PATHS[provider], {
    query: { month: query.month, budget: query.budget },
    timeoutMs: USAGE_TIMEOUT_MS,
    baseUrl,
  });
}
