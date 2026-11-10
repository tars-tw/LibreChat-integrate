import { TARS_MEMORY_LIMITS } from 'librechat-data-provider';
import {
  profileLines,
  categoryLabelKey,
  getTarsMemoryError,
  getTarsMemoryAddError,
  getTarsMemoryFailureKey,
} from './validate';

const { profileMaxItems, profileMaxItemChars, semanticMaxChars } = TARS_MEMORY_LIMITS;
const lines = (count: number) => Array.from({ length: count }, (_, i) => `item ${i}`).join('\n');

describe('profileLines', () => {
  it('drops bullets and blank lines as pwc_tars does', () => {
    expect(profileLines('- a\n\n* b\n• c\n  d')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('keeps a leading sign that is not a bullet, as pwc_tars does', () => {
    expect(profileLines('-5 度\n*重要*')).toEqual(['-5 度', '*重要*']);
  });
});

describe('getTarsMemoryError', () => {
  it('requires content', () => {
    expect(getTarsMemoryError('semantic', ' \n ')?.key).toBe('com_ui_field_required');
    expect(getTarsMemoryError('profile', ' - \n')?.key).toBe('com_ui_field_required');
  });

  it('accepts a profile at its limits and refuses one past them', () => {
    expect(getTarsMemoryError('profile', lines(profileMaxItems))).toBeNull();
    expect(getTarsMemoryError('profile', lines(profileMaxItems + 1))?.key).toBe(
      'com_ui_tars_memory_error_profile_items',
    );
    expect(getTarsMemoryError('profile', 'x'.repeat(profileMaxItemChars))).toBeNull();
    expect(getTarsMemoryError('profile', 'x'.repeat(profileMaxItemChars + 1))?.key).toBe(
      'com_ui_tars_memory_error_profile_length',
    );
  });

  it('accepts a semantic record at its limit and refuses one past it', () => {
    expect(getTarsMemoryError('semantic', 'x'.repeat(semanticMaxChars))).toBeNull();
    expect(getTarsMemoryError('semantic', 'x'.repeat(semanticMaxChars + 1))?.key).toBe(
      'com_ui_tars_memory_error_semantic_length',
    );
  });
});

describe('getTarsMemoryAddError', () => {
  const held = Array.from({ length: profileMaxItems }, (_, i) => `item ${i}`);

  it('requires content', () => {
    expect(getTarsMemoryAddError(' \n- ', [])?.key).toBe('com_ui_field_required');
  });

  it('counts what the profile holds toward the limit', () => {
    expect(getTarsMemoryAddError('new', held.slice(1))).toBeNull();
    expect(getTarsMemoryAddError('new', held)?.key).toBe('com_ui_tars_memory_error_profile_items');
  });

  it('does not count a line the profile already holds', () => {
    expect(getTarsMemoryAddError('item 0', held)).toBeNull();
  });

  it('limits each line', () => {
    expect(getTarsMemoryAddError('x'.repeat(profileMaxItemChars + 1), [])?.key).toBe(
      'com_ui_tars_memory_error_profile_length',
    );
  });
});

describe('getTarsMemoryFailureKey', () => {
  it.each([
    [404, 'com_ui_tars_memory_error_stale'],
    [400, 'com_ui_tars_memory_error_invalid'],
    [503, 'com_ui_tars_memory_error_load'],
    [500, 'com_ui_tars_memory_error_save'],
  ])('maps %i', (status, key) => {
    expect(getTarsMemoryFailureKey({ response: { status } })).toBe(key);
  });
});

describe('categoryLabelKey', () => {
  it('labels what extraction writes and leaves the rest as stored', () => {
    expect(categoryLabelKey(' Preference ')).toBe('com_ui_tars_memory_category_preference');
    expect(categoryLabelKey('other')).toBeUndefined();
  });
});
