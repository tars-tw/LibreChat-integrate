import { UNCATEGORIZED, promptCategoryKey, summarizePromptCategories } from '../filter';

describe('Tars prompt category filter', () => {
  it('keys a blank or missing category as uncategorized and trims the rest', () => {
    expect(promptCategoryKey({ category: '  合約 ' })).toBe('合約');
    expect(promptCategoryKey({ category: '   ' })).toBe(UNCATEGORIZED);
    expect(promptCategoryKey({ category: null })).toBe(UNCATEGORIZED);
  });

  it('merges a name shared by several tiers, sorts by name and puts uncategorized last', () => {
    expect(
      summarizePromptCategories([
        { category: '測試' },
        { category: null },
        { category: 'aaron' },
        { category: '測試 ' },
        { category: 'aaron' },
      ]),
    ).toEqual([
      { value: 'aaron', count: 2 },
      { value: '測試', count: 2 },
      { value: UNCATEGORIZED, count: 1 },
    ]);
  });

  it('lists nothing for no prompts', () => {
    expect(summarizePromptCategories([])).toEqual([]);
  });
});
