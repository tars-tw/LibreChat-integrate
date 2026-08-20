import type { TTarsSysConfig, TTarsUsageProvider } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';

/** pwc_tars seeds every credential row with this sentinel; it means "unset". */
const UNSET_VALUE = 'DEFAULT';

export interface ModelKeyField {
  key: string;
  hintKey: TranslationKeys;
  /** A price-query key bills the provider; the chat key drives completions. */
  billing?: boolean;
}

export interface ModelKeyGroup {
  /** The provider brand, kept verbatim — it is a proper noun, not UI copy. */
  title: string;
  usageProvider?: TTarsUsageProvider;
  fields: ModelKeyField[];
}

export const MODEL_KEY_GROUPS: ModelKeyGroup[] = [
  {
    title: 'OpenAI',
    usageProvider: 'openai',
    fields: [
      { key: 'KEY_OPEN_AI_API', hintKey: 'com_ui_tars_keys_openai_hint' },
      {
        key: 'KEY_OPEN_AI_PRICE_API',
        hintKey: 'com_ui_tars_keys_openai_price_hint',
        billing: true,
      },
    ],
  },
  {
    title: 'Google Gemini',
    fields: [{ key: 'KEY_GEMINI_API', hintKey: 'com_ui_tars_keys_gemini_hint' }],
  },
  {
    title: 'Anthropic',
    usageProvider: 'anthropic',
    fields: [
      { key: 'KEY_ANTHROPIC_API', hintKey: 'com_ui_tars_keys_anthropic_hint' },
      {
        key: 'KEY_ANTHROPIC_PRICE_API',
        hintKey: 'com_ui_tars_keys_anthropic_price_hint',
        billing: true,
      },
    ],
  },
];

export const MODEL_KEY_NAMES: string[] = MODEL_KEY_GROUPS.flatMap((group) =>
  group.fields.map((field) => field.key),
);

/** The stored key, with pwc_tars' unset sentinel and padding normalized away. */
export const readKeyValue = (config: TTarsSysConfig | undefined): string => {
  const value = config?.value?.trim() ?? '';
  return value.toUpperCase() === UNSET_VALUE ? '' : value;
};

/** Same shape the system-parameter listing masks with, so the two pages agree. */
export const maskKey = (value: string): string => {
  if (value === '') {
    return '';
  }
  if (value.length <= 8) {
    return '••••••';
  }
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
};

export const formatTokens = (value: number | null | undefined): string =>
  (value ?? 0).toLocaleString();

/**
 * Provider spend spans six orders of magnitude — a month of embeddings can cost
 * fractions of a cent — so the precision follows the amount rather than a fixed
 * two decimals, which would render every small line item as `$0.00`.
 */
export const formatCurrency = (amount: number | null | undefined): string => {
  if (amount == null) {
    return '$0.00';
  }
  const magnitude = Math.abs(amount);
  if (magnitude === 0) {
    return '$0.00';
  }
  if (magnitude < 0.01) {
    return `$${amount.toFixed(6)}`;
  }
  if (magnitude < 1) {
    return `$${amount.toFixed(4)}`;
  }
  return `$${amount.toFixed(2)}`;
};

export const percentOf = (value: number, total: number): number =>
  total === 0 ? 0 : Math.round((value / total) * 100);

/** `YYYY-MM` for a native month input, in the browser's own timezone. */
export const monthValue = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

export const currentMonth = (): string => monthValue(new Date());

/** `2026-08-14` → `8/14`, the compact form the daily chart's axis needs. */
export const shortDate = (date: string): string => {
  const parts = date.split('-');
  return parts.length >= 3 ? `${Number(parts[1])}/${Number(parts[2])}` : date;
};
