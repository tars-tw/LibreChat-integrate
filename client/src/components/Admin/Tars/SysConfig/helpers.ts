import type { TTarsSysConfig } from 'librechat-data-provider';

/** pwc_tars stores a parameter's status as the same 'active'/'inactive' strings the user table uses. */
export const isSysConfigActive = (config: TTarsSysConfig): boolean => config.status === 'active';

const SECRET_KEY_PATTERN = /KEY|API/i;

/**
 * Masks credential-shaped values in the table. pwc_tars keeps real provider keys
 * in this table, so the listing only ever shows the first and last four
 * characters; the edit dialog is the one place that reveals the full value.
 */
export const maskSysConfigValue = (config: TTarsSysConfig): string => {
  const value = config.value ?? '';
  if (!value || !SECRET_KEY_PATTERN.test(config.key)) {
    return value;
  }
  if (value.length <= 8) {
    return '••••••';
  }
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
};
