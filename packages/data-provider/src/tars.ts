/**
 * Shared pwc_tars data-source facts. Both the form in the browser and the
 * proxy in `packages/api` validate against these, so the two can never drift.
 */

/**
 * The application-database kinds the admin page offers.
 *
 * pwc_tars' own dropdown also lists CSV, but no CSV row can be stored:
 * `create_dataset_sql` requires host/port/username/password and
 * `test_connection` has no CSV handler. Oracle has a Service Name / SID toggle
 * upstream, yet neither create nor update reads those columns and every
 * consumer builds `oracle+oracledb://…?service_name={database_name}`, so
 * Oracle is Service-Name-only here.
 */
export const TARS_DATABASE_TYPES = ['PostgreSQL', 'MySQL', 'MSSQL', 'Oracle', 'SQLite'] as const;

export type TTarsDatabaseType = (typeof TARS_DATABASE_TYPES)[number];

/** Ports pwc_tars' form pre-fills. SQLite is file-backed and stores port 1. */
export const TARS_DEFAULT_PORTS: Partial<Record<TTarsDatabaseType, number>> = {
  PostgreSQL: 5432,
  MySQL: 3306,
  MSSQL: 1433,
  Oracle: 1521,
};

export const isTarsDatabaseType = (value: unknown): value is TTarsDatabaseType =>
  TARS_DATABASE_TYPES.includes(value as TTarsDatabaseType);

/** A file-backed connection is defined by its uploaded file, not by a host. */
export const isTarsFileDatabase = (dbType: string | null | undefined): boolean =>
  dbType === 'SQLite';

/** Extensions pwc_tars accepts for a SQLite upload (`ALLOWED_SQLITE_EXTENSIONS`). */
export const TARS_SQLITE_EXTENSIONS = ['.sqlite', '.db', '.sqlite3', '.s3db', '.sl3'];
