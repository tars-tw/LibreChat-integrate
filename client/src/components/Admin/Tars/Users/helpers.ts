import type { TTarsUser, TTarsRole, TTarsUserGroup } from 'librechat-data-provider';

export const ACTIVE = 'active';
export const INACTIVE = 'inactive';

export const isActive = (user: TTarsUser): boolean => user.status === ACTIVE;

/**
 * pwc_tars's AD accounts are exactly those with `is_sso_user`; `is_syncbyad` only
 * records how the row arrived. Their email comes from AD, so pwc_tars refuses edits to it.
 */
export const isAdAccount = (user: TTarsUser): boolean => user.is_sso_user === true;

/** pwc_tars stores multi-valued id columns as a trimmed comma-separated string. */
export const csvToIds = (raw: string | null | undefined): string[] =>
  (raw ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

export const idsToCsv = (ids: string[]): string | null => (ids.length > 0 ? ids.join(',') : null);

const NAME_PREVIEW_LIMIT = 5;

/** The first few usernames for a toast or warning, with an ellipsis when there are more. */
export const previewNames = (users: Array<Pick<TTarsUser, 'username'>>): string => {
  const names = users.slice(0, NAME_PREVIEW_LIMIT).map((user) => user.username);
  return users.length > NAME_PREVIEW_LIMIT ? `${names.join(', ')}, …` : names.join(', ');
};

export const toNameMap = <T extends { id: string | number; name: string }>(
  items: T[],
): Map<string, string> => new Map(items.map((item) => [String(item.id), item.name]));

/**
 * The role names shown on a row. pwc_tars precomputes `roles_names` as the
 * union of the account's own role and every role its groups grant; the direct
 * `role_id` lookup is the fallback for rows created before that field existed.
 */
export const resolveRoleNames = (user: TTarsUser, roles: Map<string, string>): string[] => {
  const precomputed = csvToIds(user.roles_names);
  if (precomputed.length > 0) {
    return precomputed;
  }
  const own = user.role_id != null ? roles.get(String(user.role_id)) : undefined;
  return own ? [own] : [];
};

export const resolveGroupNames = (user: TTarsUser, groups: Map<string, string>): string[] =>
  csvToIds(user.user_group_id)
    .map((id) => groups.get(id))
    .filter((name): name is string => !!name);

export const formatDateTime = (value: string | null | undefined, locale: string): string => {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleString(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

/** Byte-order mark: without it Excel reads the CJK columns as mojibake. */
const BOM = '\uFEFF';

const escapeCsvCell = (value: string): string =>
  /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

/**
 * Builds a UTF-8 CSV with a BOM so Excel opens the CJK columns correctly —
 * the pwc_tars page shipped `.xlsx`, which would cost the client a spreadsheet
 * dependency for an export the browser can produce on its own.
 */
export const toCsvBlob = (headers: string[], rows: string[][]): Blob => {
  const lines = [headers, ...rows].map((row) => row.map(escapeCsvCell).join(','));
  return new Blob([`${BOM}${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8;' });
};

export const downloadBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

export type RoleOption = Pick<TTarsRole, 'id' | 'name'>;
export type GroupOption = Pick<TTarsUserGroup, 'id' | 'name'>;
