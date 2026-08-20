import type { TTarsSsoConfig } from 'librechat-data-provider';

/** The LibreChat-proxied pwc_tars system logo. Cache-busted after every change. */
export const systemLogoSrc = (version?: number | string): string =>
  version == null ? '/api/tars/settings/logo' : `/api/tars/settings/logo?v=${version}`;

export const isSsoConfigEnabled = (config: TTarsSsoConfig): boolean => Number(config.status) === 1;

/** pwc_tars keeps the LDAP whitelist as a single `;`-separated string. */
export const whitelistToUsernames = (raw: string | null | undefined): string[] =>
  (raw ?? '')
    .split(';')
    .map((name) => name.trim())
    .filter(Boolean);

export const usernamesToWhitelist = (usernames: string[]): string => usernames.join(';');

/** pwc_tars parses schedule times with `%Y-%m-%dT%H:%M`, so seconds are trimmed. */
export const toScheduleInputValue = (raw: string | null | undefined): string => {
  if (!raw) {
    return '';
  }
  return raw.replace(' ', 'T').slice(0, 16);
};

export const FREQUENCY_UNITS = ['hour', 'day', 'week', 'month'] as const;
export type FrequencyUnit = (typeof FREQUENCY_UNITS)[number];

/** Connection fields pwc_tars needs in the body of its tree / whitelist calls. */
export const connectionPayload = (config: TTarsSsoConfig) => ({
  ldap_server_address: config.ldap_server_address ?? '',
  ldap_server_port: config.ldap_server_port ?? '',
  ldap_base_dn: config.ldap_base_dn ?? '',
  ldap_admin_dn: config.ldap_admin_dn ?? '',
  ldap_admin_password: config.ldap_admin_password ?? '',
  ldap_search_attribute: config.ldap_search_attribute ?? 'sAMAccountName',
});
