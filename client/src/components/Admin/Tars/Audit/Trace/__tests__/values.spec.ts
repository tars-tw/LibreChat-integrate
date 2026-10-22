import { ownValue, stringList, fixedNumber } from '../values';
import { fmtClock, planStatusLabel } from '../layout';
import { overviewAttachments } from '../documents';
import { rowDurationMs } from '../time';
import { toolLabel } from '../icons';

const t = (key: string) => `t:${key}`;

describe('ownValue', () => {
  const labels: Record<string, string> = { pending: 'Pending' };

  it('reads the map’s own entries only', () => {
    expect(ownValue(labels, 'pending')).toBe('Pending');
    expect(ownValue(labels, 'constructor')).toBeUndefined();
    expect(ownValue(labels, '__proto__')).toBeUndefined();
    expect(ownValue(labels, null)).toBeUndefined();
  });

  it('keeps a trace value that names an inherited member from reading as a label', () => {
    expect(planStatusLabel(t as never, 'constructor')).toBe('constructor');
    expect(toolLabel(t as never, 'toString')).toBe('toString');
  });
});

describe('stringList', () => {
  it('keeps the non-empty strings of a list and reads anything else as empty', () => {
    expect(stringList(['a.pdf', '', 3, null, 'b.pdf'])).toEqual(['a.pdf', 'b.pdf']);
    expect(stringList('a.pdf')).toEqual([]);
    expect(stringList(undefined)).toEqual([]);
  });
});

describe('fixedNumber', () => {
  it('prints a dash rather than NaN for a value that is not a number', () => {
    expect(fixedNumber(0.25, 4)).toBe('0.2500');
    expect(fixedNumber('0.5', 2)).toBe('0.50');
    expect(fixedNumber('high', 4)).toBe('—');
    expect(fixedNumber(null, 4)).toBe('—');
    expect(fixedNumber('', 4)).toBe('—');
  });
});

describe('rowDurationMs', () => {
  it('takes the recorded duration, else a readable span, else nothing', () => {
    expect(rowDurationMs({ duration_ms: 40, started_at: null, ended_at: null })).toBe(40);
    expect(
      rowDurationMs({
        duration_ms: null,
        started_at: '2026-10-22T01:00:00.000Z',
        ended_at: '2026-10-22T01:00:01.500Z',
      }),
    ).toBe(1500);
    expect(
      rowDurationMs({ duration_ms: null, started_at: 'yesterday', ended_at: '2026-10-22' }),
    ).toBeNull();
    expect(
      rowDurationMs({
        duration_ms: null,
        started_at: '2026-10-22T01:00:01Z',
        ended_at: '2026-10-22T01:00:00Z',
      }),
    ).toBeNull();
  });
});

describe('fmtClock', () => {
  it('prints a dash for a time a Date cannot hold instead of throwing', () => {
    expect(fmtClock(1e20)).toBe('—');
    expect(fmtClock(Number.NaN)).toBe('—');
    expect(fmtClock('not a time')).toBe('—');
    expect(fmtClock(null)).toBe('—');
    expect(fmtClock(Date.UTC(2026, 9, 22))).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}$/);
  });
});

describe('overviewAttachments', () => {
  it('leaves out a document without a name or a known way it reached the model', () => {
    const files = overviewAttachments(
      [
        { file_id: 'f-1', filename: 'a.csv', injected_as: 'data_file' },
        { file_id: 'f-2', filename: '', injected_as: 'summary' },
        { file_id: 'f-3', filename: 'b.txt', injected_as: 'unknown' },
      ],
      { files: [{ file_id: 'f-1' }] },
    );
    expect(files).toEqual([
      expect.objectContaining({ id: 'f-1', filename: 'a.csv', injectedAs: 'data_file' }),
    ]);
  });
});
