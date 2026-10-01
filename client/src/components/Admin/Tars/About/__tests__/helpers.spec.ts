import type { ReleaseNote } from '../helpers';
import { filterNotes, parseReleaseNote } from '../helpers';

describe('parseReleaseNote', () => {
  it('drops the top-level title and splits on `##` headings', () => {
    expect(parseReleaseNote('\n# Release 1.2\n## 新功能\n- a\n- b\n## 修正\n- c')).toEqual({
      intro: '',
      sections: [
        { title: '新功能', content: '- a\n- b' },
        { title: '修正', content: '- c' },
      ],
    });
  });

  it('keeps text before the first heading as the intro, not as a section', () => {
    expect(parseReleaseNote('# Release\n\nIntro paragraph\n\n## 新功能\n- a')).toEqual({
      intro: 'Intro paragraph',
      sections: [{ title: '新功能', content: '- a' }],
    });
  });

  it('returns the whole note as the intro when it has no `##` heading', () => {
    expect(parseReleaseNote('- only bullets\n- no headings')).toEqual({
      intro: '- only bullets\n- no headings',
      sections: [],
    });
  });
});

describe('filterNotes', () => {
  const note = (id: string, version: string, title: string, content = ''): ReleaseNote => ({
    id,
    version,
    title,
    content,
    created_at: '',
  });
  const notes = [
    note('a', 'v1.3.0', 'Upcoming Features', '## 即將推出'),
    note('b', 'v1.0.4', 'Release v1.0.4', 'Fix permission bug'),
  ];

  it('finds a note by a version its title does not mention', () => {
    expect(filterNotes(notes, 'V1.3').map((n) => n.id)).toEqual(['a']);
  });

  it('still matches title and content', () => {
    expect(filterNotes(notes, 'permission').map((n) => n.id)).toEqual(['b']);
    expect(filterNotes(notes, '  ').map((n) => n.id)).toEqual(['a', 'b']);
  });
});
