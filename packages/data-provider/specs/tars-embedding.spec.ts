import {
  isTarsEmbeddingSplitBy,
  isTarsEmbeddingGroupBy,
  isTarsEmbeddingRangeTooLong,
} from '../src/tars';
import { tarsEmbeddingUsageConfigSchema } from '../src/config';

describe('tars embedding usage facts', () => {
  it('knows which dimensions pwc_tars groups and splits by', () => {
    expect(isTarsEmbeddingGroupBy('day')).toBe(true);
    expect(isTarsEmbeddingGroupBy('user')).toBe(false);
    expect(isTarsEmbeddingGroupBy(undefined)).toBe(false);
    expect(isTarsEmbeddingSplitBy('knowledge_base')).toBe(true);
    expect(isTarsEmbeddingSplitBy('day')).toBe(false);
  });

  it('refuses ranges over a year, counting both ends', () => {
    expect(isTarsEmbeddingRangeTooLong({ start_date: '2025-10-01', end_date: '2026-10-01' })).toBe(
      false,
    );
    expect(isTarsEmbeddingRangeTooLong({ start_date: '2025-10-01', end_date: '2026-10-02' })).toBe(
      true,
    );
  });

  it('defaults the pwc_tars timeouts to the values the routes used before they were configurable', () => {
    expect(tarsEmbeddingUsageConfigSchema.parse({})).toEqual({
      reportTimeoutMs: 60_000,
      messageTimeoutMs: 15_000,
    });
    expect(tarsEmbeddingUsageConfigSchema.safeParse({ reportTimeoutMs: 10 }).success).toBe(false);
  });
});
