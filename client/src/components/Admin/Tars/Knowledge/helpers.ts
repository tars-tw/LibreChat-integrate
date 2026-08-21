import { Code, Database, FileText, Globe, Server } from 'lucide-react';
import type {
  TTarsKnowledgeBase,
  TTarsKnowledgeBaseGroup,
  TTarsKnowledgeBaseUser,
} from 'librechat-data-provider';
import type { LucideIcon } from 'lucide-react';
import type { PickerOption } from '../Audit/Picker';
import type { TranslationKeys } from '~/hooks';
import { pickerLabel } from '../Audit/Picker';

/**
 * The five dataset kinds a knowledge base can hold, in the order the original
 * page shows them. Each count comes straight from `knowledge_base/prepare_data`.
 */
export interface DatasetStat {
  key: 'documents' | 'websites' | 'apis' | 'fileSystems' | 'database';
  icon: LucideIcon;
  labelKey: TranslationKeys;
}

export const DATASET_STATS: DatasetStat[] = [
  { key: 'documents', icon: FileText, labelKey: 'com_ui_tars_kb_stat_documents' },
  { key: 'websites', icon: Globe, labelKey: 'com_ui_tars_kb_stat_websites' },
  { key: 'apis', icon: Code, labelKey: 'com_ui_tars_kb_stat_apis' },
  { key: 'fileSystems', icon: Server, labelKey: 'com_ui_tars_kb_stat_file_systems' },
  { key: 'database', icon: Database, labelKey: 'com_ui_tars_kb_stat_database' },
];

/**
 * How many of a kind the base holds. The database column is a flag rather than
 * a count in pwc_tars, so it reports 1 or 0 and is rendered without a number.
 */
export const datasetCount = (kb: TTarsKnowledgeBase, key: DatasetStat['key']): number => {
  switch (key) {
    case 'documents':
      return kb.document_count ?? 0;
    case 'websites':
      return kb.website_count ?? 0;
    case 'apis':
      return kb.api_count ?? 0;
    case 'fileSystems':
      return kb.fs_count ?? 0;
    default:
      return kb.has_sql_database === true ? 1 : 0;
  }
};

/** pwc_tars' own default when a base has never had one set. */
export const DEFAULT_MAX_RETRIEVE = 20;

/** Matches the original page: case-insensitive, name only. */
export const filterByName = (
  knowledgeBases: TTarsKnowledgeBase[],
  search: string,
): TTarsKnowledgeBase[] => {
  const query = search.trim().toLowerCase();
  if (query === '') {
    return knowledgeBases;
  }
  return knowledgeBases.filter((kb) => kb.name.toLowerCase().includes(query));
};

/**
 * Traditional-Chinese collation, so 知識庫 names sort the way an operator reads
 * them rather than by code point.
 */
const byLabel = (a: PickerOption, b: PickerOption): number =>
  a.label.localeCompare(b.label, 'zh-Hant');

export const userPickerOptions = (users: TTarsKnowledgeBaseUser[]): PickerOption[] =>
  users
    .map((user) => ({
      value: user.id,
      label: pickerLabel(user.display_name, user.username, user.id),
    }))
    .sort(byLabel);

export const groupPickerOptions = (groups: TTarsKnowledgeBaseGroup[]): PickerOption[] =>
  groups
    .map((group) => ({ value: group.id, label: pickerLabel(group.name, group.id) }))
    .sort(byLabel);

/** pwc_tars stores an empty allow-list to mean "no restriction". */
export const accessSummaryKey = (kb: TTarsKnowledgeBase): TranslationKeys =>
  (kb.allowed_user_ids?.length ?? 0) + (kb.allowed_user_group_ids?.length ?? 0) === 0
    ? 'com_ui_tars_kb_access_everyone'
    : 'com_ui_tars_kb_access_restricted';
