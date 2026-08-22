import { Database, FileCode2, Layers, Server, Table2 } from 'lucide-react';
import { TARS_DATABASE_TYPES, TARS_DEFAULT_PORTS } from 'librechat-data-provider';
import type { TTarsDatabaseType, TTarsDatasetDatabase } from 'librechat-data-provider';
import type { LucideIcon } from 'lucide-react';
import type { PickerOption } from '../Audit/Picker';

export const NAME_MIN = 2;
export const NAME_MAX = 40;
const PORT_MAX = 65535;

/** Each kind gets its own mark so the type is readable at a glance in the list. */
export const DATABASE_ICONS: Record<TTarsDatabaseType, LucideIcon> = {
  PostgreSQL: Database,
  MySQL: Layers,
  MSSQL: Server,
  Oracle: Table2,
  SQLite: FileCode2,
};

export const databaseIcon = (dbType: string | null | undefined): LucideIcon =>
  DATABASE_ICONS[dbType as TTarsDatabaseType] ?? Database;

export const defaultPort = (dbType: TTarsDatabaseType): string =>
  TARS_DEFAULT_PORTS[dbType] != null ? String(TARS_DEFAULT_PORTS[dbType]) : '';

export interface DatabaseForm {
  name: string;
  description: string;
  dbType: TTarsDatabaseType;
  host: string;
  port: string;
  databaseName: string;
  /** Both start blank on edit — pwc_tars credentials never reach the browser. */
  username: string;
  password: string;
  enabled: boolean;
  allowedKmIds: string[];
}

export const emptyDatabaseForm: DatabaseForm = {
  name: '',
  description: '',
  dbType: TARS_DATABASE_TYPES[0],
  host: '',
  port: defaultPort(TARS_DATABASE_TYPES[0]),
  databaseName: '',
  username: '',
  password: '',
  enabled: true,
  allowedKmIds: [],
};

export const toDatabaseForm = (database: TTarsDatasetDatabase): DatabaseForm => ({
  ...emptyDatabaseForm,
  name: database.name,
  description: database.description ?? '',
  dbType: (database.db_type as TTarsDatabaseType) ?? TARS_DATABASE_TYPES[0],
  host: database.host ?? '',
  port: database.port != null ? String(database.port) : '',
  databaseName: database.database_name ?? '',
  enabled: database.status !== 0,
  allowedKmIds: database.allowed_km_ids ?? [],
});

/**
 * What a form needs before pwc_tars will accept it. A file-backed connection is
 * defined by its upload, so it only needs a name; every other kind needs a
 * reachable endpoint.
 *
 * The account and password are not part of this check on an existing row:
 * neither ever reaches the browser, so both start blank and a blank field means
 * "keep what is stored".
 */
export const connectionFieldsFilled = (form: DatabaseForm, isEdit: boolean): boolean => {
  if (form.host.trim() === '' || form.databaseName.trim() === '') {
    return false;
  }
  return isEdit || (form.username.trim() !== '' && form.password.trim() !== '');
};

export const portInvalid = (port: string): boolean => {
  if (port.trim() === '') {
    return true;
  }
  const value = Number(port);
  return !Number.isInteger(value) || value < 0 || value > PORT_MAX;
};

export const nameInvalid = (name: string): boolean => {
  const trimmed = name.trim();
  return trimmed.length < NAME_MIN || trimmed.length > NAME_MAX;
};

/** Matches the original page: case-insensitive, across the fields on screen. */
export const filterDatabases = (
  databases: TTarsDatasetDatabase[],
  search: string,
  dbType: string,
): TTarsDatasetDatabase[] => {
  const query = search.trim().toLowerCase();
  return databases.filter((database) => {
    if (dbType !== '' && database.db_type !== dbType) {
      return false;
    }
    if (query === '') {
      return true;
    }
    return [database.name, database.host, database.database_name].some(
      (field) => field != null && field.toLowerCase().includes(query),
    );
  });
};

/**
 * Names for the knowledge bases a connection is granted to. Ids with no
 * matching base are kept as-is rather than dropped, so a grant pointing at a
 * deleted base stays visible instead of silently vanishing from the row.
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
