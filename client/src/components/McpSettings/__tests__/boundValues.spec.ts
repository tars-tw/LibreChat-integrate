import {
  endpointOf,
  setBoundValue,
  isStaleBinding,
  readBoundValues,
  withBoundValues,
  headersToRows,
  rowsToHeaders,
  syncCounts,
  blockedToolsSummary,
} from '../boundValues';

const orders = {
  name: 'get_orders',
  method: 'get',
  path: '/orders',
  fields: [
    { in: 'header', name: 'X-User-Email', type: 'string', required: true },
    { in: 'query', name: 'status', type: 'string', required: false },
  ],
};

describe('OpenAPI fixed values', () => {
  it('keys bindings by upper-cased method and path, not by tool name', () => {
    expect(endpointOf(orders)).toBe('GET /orders');
  });

  it('adds, replaces and removes a binding without touching other endpoints', () => {
    const field = { in: 'header', name: 'X-User-Email' };
    let bound = setBoundValue(
      { 'POST /tickets': [{ in: 'body', name: 'reporter', value: 'x' }] },
      'GET /orders',
      field,
      '{{TARS_CURRENT_USER_EMAIL}}',
    );
    expect(bound['GET /orders']).toEqual([
      { in: 'header', name: 'X-User-Email', value: '{{TARS_CURRENT_USER_EMAIL}}' },
    ]);

    bound = setBoundValue(bound, 'GET /orders', field, 'fixed@example.com');
    expect(bound['GET /orders']).toHaveLength(1);
    expect(bound['GET /orders'][0].value).toBe('fixed@example.com');

    bound = setBoundValue(bound, 'GET /orders', field, '   ');
    expect(bound).not.toHaveProperty('GET /orders');
    expect(bound['POST /tickets']).toHaveLength(1);
  });

  it('flags a binding whose endpoint or field the loaded spec no longer has', () => {
    const header = { in: 'header', name: 'X-User-Email' };
    expect(isStaleBinding([], 'GET /orders', header)).toBe(false);
    expect(isStaleBinding([orders], 'GET /orders', header)).toBe(false);
    expect(isStaleBinding([orders], 'GET /orders', { in: 'query', name: 'gone' })).toBe(true);
    expect(isStaleBinding([orders], 'DELETE /orders', header)).toBe(true);
  });

  it('reads only well-formed stored bindings', () => {
    expect(
      readBoundValues({
        prefix: 'crm',
        bound_values: {
          'GET /orders': [{ in: 'header', name: 'X-User-Email', value: 'a' }, { nope: true }],
          'POST /x': 'not a list',
        },
      }),
    ).toEqual({ 'GET /orders': [{ in: 'header', name: 'X-User-Email', value: 'a' }] });
    expect(readBoundValues({ bound_values: [] })).toEqual({});
    expect(readBoundValues(null)).toEqual({});
  });

  it('keeps the naming options when saving and drops bound_values once all are removed', () => {
    const config = { prefix: 'crm', bound_values: { 'GET /orders': [] } };
    expect(
      withBoundValues(config, {
        'GET /orders': [{ in: 'header', name: 'X-User-Email', value: ' a ' }],
      }),
    ).toEqual({
      prefix: 'crm',
      bound_values: { 'GET /orders': [{ in: 'header', name: 'X-User-Email', value: 'a' }] },
    });
    expect(withBoundValues(config, {})).toEqual({ prefix: 'crm' });
  });
});

describe('static headers', () => {
  it('round-trips the stored headers and drops rows without a name', () => {
    const rows = headersToRows({ 'X-User-Email': '{{TARS_CURRENT_USER_EMAIL}}', 'X-Num': 1 });
    expect(rows).toEqual([
      { name: 'X-User-Email', value: '{{TARS_CURRENT_USER_EMAIL}}' },
      { name: 'X-Num', value: '1' },
    ]);
    expect(
      rowsToHeaders([
        ...rows,
        { name: '  ', value: 'ignored' },
        { name: ' X-Trim ', value: ' v ' },
      ]),
    ).toEqual({
      'X-User-Email': '{{TARS_CURRENT_USER_EMAIL}}',
      'X-Num': '1',
      'X-Trim': 'v',
    });
    expect(headersToRows(undefined)).toEqual([]);
    expect(headersToRows(['x'])).toEqual([]);
  });
});

describe('sync result', () => {
  it('reads the counts pwc_tars sends and falls back to the older names', () => {
    expect(syncCounts({ created_count: 2, updated_count: 1, deleted_count: 0 })).toEqual({
      created: 2,
      updated: 1,
      deleted: 0,
    });
    expect(syncCounts({ created: 3 })).toEqual({ created: 3, updated: 0, deleted: 0 });
    expect(syncCounts(undefined)).toEqual({ created: 0, updated: 0, deleted: 0 });
  });

  it('summarises blocked tools with their missing fields', () => {
    expect(
      blockedToolsSummary({
        blocked_tools: [
          { name: 'get_orders', missing_fields: ['header.X-User-Email'] },
          { name: 'list', missing_fields: ['query.a', 'query.b'] },
        ],
      }),
    ).toBe('get_orders (header.X-User-Email), list (query.a, query.b)');
    expect(blockedToolsSummary({})).toBe('');
  });
});
