import { oracleConnectionTypeOf, toDatabaseForm } from '../helpers';
import type { TTarsDatasetDatabase } from 'librechat-data-provider';

const row: TTarsDatasetDatabase = {
  id: 'db-1',
  name: 'erp',
  description: null,
  db_type: 'Oracle',
  host: 'ora.internal',
  port: 1521,
  database_name: 'ORCL',
  schema: null,
  service_name: null,
  sid: null,
  status: 1,
  allowed_km_ids: [],
  created_at: null,
  updated_at: null,
};

describe('oracleConnectionTypeOf', () => {
  it('reads a row with only a SID as SID', () => {
    expect(oracleConnectionTypeOf({ ...row, sid: 'ORCL' })).toBe('sid');
  });

  it('treats a Service Name row as Service Name even when a stale SID remains', () => {
    expect(oracleConnectionTypeOf({ ...row, service_name: 'XEPDB1', sid: 'ORCL' })).toBe(
      'service_name',
    );
  });

  it('falls back to Service Name for rows saved before sid was persisted', () => {
    expect(oracleConnectionTypeOf(row)).toBe('service_name');
    expect(toDatabaseForm(row).oracleConnectionType).toBe('service_name');
  });
});
