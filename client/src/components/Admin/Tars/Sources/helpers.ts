import type { PickerOption } from '../Audit/Picker';

/** Shared by every 資料源管理 master page: databases, document groups, websites. */
export const NAME_MIN = 2;
export const NAME_MAX = 40;
const PORT_MAX = 65535;

export const nameInvalid = (name: string): boolean => {
  const trimmed = name.trim();
  return trimmed.length < NAME_MIN || trimmed.length > NAME_MAX;
};

export const portInvalid = (port: string): boolean => {
  if (port.trim() === '') {
    return true;
  }
  const value = Number(port);
  return !Number.isInteger(value) || value < 0 || value > PORT_MAX;
};

/**
 * Names for the knowledge bases a source is granted to. Ids with no matching
 * base are kept as-is rather than dropped, so a grant pointing at a deleted
 * base stays visible instead of silently vanishing from the row.
 */
export const knowledgeBaseNames = (
  allowedKmIds: string[],
  namesById: Map<string, string>,
): string[] => allowedKmIds.map((id) => namesById.get(id) ?? id);

const byLabel = (a: PickerOption, b: PickerOption): number =>
  a.label.localeCompare(b.label, 'zh-Hant');

export const knowledgeBasePickerOptions = (
  knowledgeBases: { id: string; name: string }[],
): PickerOption[] => knowledgeBases.map((kb) => ({ value: kb.id, label: kb.name })).sort(byLabel);

/** pwc_tars explains why it refused a connection; that beats a generic string. */
export const errorMessage = (error: unknown): string | null => {
  const response = (error as { response?: { data?: { error?: unknown } } })?.response;
  const detail = response?.data?.error;
  return typeof detail === 'string' && detail !== '' ? detail : null;
};
