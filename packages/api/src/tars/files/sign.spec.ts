import {
  isTarsSpreadsheet,
  signTarsDataFileRefs,
  verifyTarsFileSignature,
  toTarsDataFileRefsContext,
} from './sign';

const NOW = Date.UTC(2026, 9, 3, 12, 0, 0);
const files = [
  { id: 'file-1', filename: '銷售.xlsx' },
  { id: 'file-2', filename: 'stock.csv' },
];

const parse = (path: string) => {
  const url = new URL(path, 'http://librechat.test');
  return {
    fileId: decodeURIComponent(url.pathname.split('/').pop() ?? ''),
    userId: url.searchParams.get('u') ?? '',
    expires: Number(url.searchParams.get('exp')),
    signature: url.searchParams.get('sig') ?? '',
  };
};

beforeEach(() => {
  process.env.JWT_SECRET = 'sign-test-secret';
});

describe('signTarsDataFileRefs', () => {
  it('signs each file for its owner with a ten-minute expiry', () => {
    const refs = signTarsDataFileRefs(files, 'user-1', NOW);

    expect(refs.map(({ id, filename }) => ({ id, filename }))).toEqual(files);
    for (const ref of refs) {
      expect(ref.path.startsWith(`/api/tars/files/${ref.id}?`)).toBe(true);
      const signed = parse(ref.path);
      expect(signed).toMatchObject({ fileId: ref.id, userId: 'user-1' });
      expect(signed.expires).toBe(NOW / 1000 + 600);
      expect(verifyTarsFileSignature(signed, NOW)).toBe(true);
    }
  });

  it('signs nothing without JWT_SECRET', () => {
    delete process.env.JWT_SECRET;
    expect(signTarsDataFileRefs(files, 'user-1', NOW)).toEqual([]);
    expect(toTarsDataFileRefsContext(files, 'user-1')).toBe('');
  });
});

describe('verifyTarsFileSignature', () => {
  const signed = () => parse(signTarsDataFileRefs(files, 'user-1', NOW)[0].path);

  it('rejects an expired reference', () => {
    expect(verifyTarsFileSignature(signed(), NOW + 601_000)).toBe(false);
  });

  it('rejects a reference moved to another file, user or expiry', () => {
    const ref = signed();
    expect(verifyTarsFileSignature({ ...ref, fileId: 'file-2' }, NOW)).toBe(false);
    expect(verifyTarsFileSignature({ ...ref, userId: 'user-2' }, NOW)).toBe(false);
    expect(verifyTarsFileSignature({ ...ref, expires: ref.expires + 60 }, NOW)).toBe(false);
    expect(verifyTarsFileSignature({ ...ref, signature: '' }, NOW)).toBe(false);
  });
});

describe('toTarsDataFileRefsContext', () => {
  it('is empty without files or a user', () => {
    expect(toTarsDataFileRefsContext([], 'user-1')).toBe('');
    expect(toTarsDataFileRefsContext(files, undefined)).toBe('');
    expect(JSON.parse(toTarsDataFileRefsContext(files, 'user-1'))).toHaveLength(2);
  });
});

describe('isTarsSpreadsheet', () => {
  it('accepts csv / xlsx / xls only, case-insensitively', () => {
    expect(['a.csv', 'b.XLSX', 'c.xls'].every(isTarsSpreadsheet)).toBe(true);
    expect(['a.pdf', 'xlsx', '', null, undefined].some(isTarsSpreadsheet)).toBe(false);
  });
});
