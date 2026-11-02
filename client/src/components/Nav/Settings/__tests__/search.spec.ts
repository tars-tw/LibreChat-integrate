import { SettingsTabValues } from 'librechat-data-provider';
import type { SettingEntry, SettingsContextValue } from '../types';
import { normalize, matchesQuery, filterSettings } from '../search';

describe('normalize', () => {
  it('lowercases and strips diacritics', () => {
    expect(normalize('Café')).toBe('cafe');
    expect(normalize('  Théme  ')).toBe('theme');
  });
});

describe('matchesQuery', () => {
  const haystack = { label: 'Theme', keywords: ['dark', 'light', 'appearance'] };

  it('matches the label case-insensitively', () => {
    expect(matchesQuery('the', haystack)).toBe(true);
    expect(matchesQuery('THEME', haystack)).toBe(true);
  });

  it('matches a keyword synonym', () => {
    expect(matchesQuery('dark', haystack)).toBe(true);
  });

  it('returns false when nothing matches', () => {
    expect(matchesQuery('zzz', haystack)).toBe(false);
  });

  it('matches everything on empty query', () => {
    expect(matchesQuery('', haystack)).toBe(true);
    expect(matchesQuery('   ', haystack)).toBe(true);
  });
});

describe('filterSettings', () => {
  const entry = (tab: SettingEntry['tab']): SettingEntry => ({
    id: tab,
    tab,
    section: 'data',
    labelKey: 'com_ui_settings_tab_data',
    Component: () => null,
  });

  it('never surfaces an entry whose tab is hidden', () => {
    const ctx = {
      langfuseConnectionAccess: true,
      langfusePromptSyncAccess: true,
    } as SettingsContextValue;
    const results = filterSettings(
      [
        entry(SettingsTabValues.GENERAL),
        entry(SettingsTabValues.DATA),
        entry(SettingsTabValues.LANGFUSE),
      ],
      'settings',
      ctx,
      (key) => key,
    );
    expect(results.map((result) => result.entry.tab)).toEqual([SettingsTabValues.GENERAL]);
  });
});
