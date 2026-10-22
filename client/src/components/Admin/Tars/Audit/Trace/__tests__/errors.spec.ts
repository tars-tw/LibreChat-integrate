import { readTraceError, traceErrorDetails, traceErrorInfo } from '../errors';

const failed = (status?: number, data?: unknown) => ({
  response: status == null && data == null ? undefined : { status, data },
});

describe('traceErrorInfo', () => {
  it('takes the server’s classification and keeps its reason', () => {
    expect(
      traceErrorInfo(failed(502, { code: 'tars_failed', error: 'x', detail: 'db down' })),
    ).toEqual({
      kind: 'tars_failed',
      titleKey: 'com_ui_tars_audit_trace_err_tars_failed',
      hintKey: 'com_ui_tars_audit_trace_err_tars_failed_hint',
      retryable: true,
      needsAdmin: false,
      status: 502,
      detail: 'db down',
    });
  });

  it('marks a setting an administrator must fix as not worth retrying', () => {
    const info = traceErrorInfo(failed(503, { code: 'secret_missing', error: 'x' }));
    expect(info).toMatchObject({ retryable: false, needsAdmin: true, detail: 'x' });
  });

  it('classifies what only the browser sees', () => {
    expect(traceErrorInfo(failed()).kind).toBe('network');
    expect(traceErrorInfo(failed(401)).kind).toBe('session_expired');
    expect(traceErrorInfo(failed(403, { error: 'pwc_tars admin access required' })).kind).toBe(
      'not_admin',
    );
    expect(traceErrorInfo(null).kind).toBe('network');
  });

  /** A newer server may send a code this client does not know; it still gets a sensible answer. */
  it('falls back on the status for an unknown code', () => {
    expect(traceErrorInfo(failed(500, { code: 'brand_new', error: 'x' })).kind).toBe('internal');
    expect(traceErrorInfo(failed(403, { code: 'brand_new' })).kind).toBe('not_admin');
  });
});

describe('readTraceError', () => {
  it('reads a JSON reason a download received as a Blob', async () => {
    const body = new Blob([
      JSON.stringify({ code: 'storage_failed', error: 'x', detail: 'ENOENT' }),
    ]);
    await expect(readTraceError(failed(500, body))).resolves.toMatchObject({
      kind: 'storage_failed',
      detail: 'ENOENT',
    });
  });

  it('classifies by status when the Blob is not JSON', async () => {
    await expect(readTraceError(failed(502, new Blob(['<html>'])))).resolves.toMatchObject({
      kind: 'internal',
      status: 502,
    });
  });
});

describe('traceErrorDetails', () => {
  it('joins what an administrator needs on one line, skipping what is unknown', () => {
    const info = traceErrorInfo(failed(504, { code: 'tars_timeout', error: 'slow' }));
    expect(traceErrorDetails(info, 'm-1')).toBe('m-1 · HTTP 504 · tars_timeout · slow');
    expect(traceErrorDetails(traceErrorInfo(failed()))).toBe('network');
  });
});
