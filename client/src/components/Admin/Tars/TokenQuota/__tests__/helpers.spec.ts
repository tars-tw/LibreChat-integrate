import { personIdentity, personName } from '../helpers';

describe('personName', () => {
  it.each([
    ['an own display name', { display_name: 'John', username: 'jdoe' }, 'John'],
    ['an empty display name', { display_name: '', username: 'jdoe' }, 'jdoe'],
    ['a blank display name', { display_name: '   ', username: 'jdoe' }, 'jdoe'],
    ['a null display name', { display_name: null, username: 'jdoe' }, 'jdoe'],
    ['a missing display name', { username: 'jdoe' }, 'jdoe'],
  ])('resolves %s', (_label, person, expected) => {
    expect(personName(person, '—')).toBe(expected);
  });

  it('uses the fallback when neither name is set, and an empty string without one', () => {
    expect(personName({ display_name: '', username: '' }, '—')).toBe('—');
    expect(personName({ display_name: null, username: null })).toBe('');
  });
});

describe('personIdentity', () => {
  const email = 'jdoe@example.com';

  it('shows the display name first and the username and email below it', () => {
    expect(personIdentity({ display_name: 'John', username: 'jdoe', email }, 'u1')).toEqual({
      primary: 'John',
      secondary: `jdoe · ${email}`,
    });
  });

  it.each(['', '   ', null])('falls back to the username for display name %j', (display_name) => {
    expect(personIdentity({ display_name, username: 'jdoe', email }, 'u1')).toEqual({
      primary: 'jdoe',
      secondary: email,
    });
  });

  it('names a report member, who carries no email, by username alone', () => {
    expect(personIdentity({ display_name: '', username: 'jdoe' }, 'u1')).toEqual({
      primary: 'jdoe',
      secondary: null,
    });
  });

  it('does not repeat a display name equal to the username', () => {
    expect(personIdentity({ display_name: 'jdoe', username: 'jdoe', email }, 'u1')).toEqual({
      primary: 'jdoe',
      secondary: email,
    });
  });

  it('falls back to the id when the person has no names', () => {
    expect(personIdentity({ display_name: '', username: null }, 'u1')).toEqual({
      primary: 'u1',
      secondary: null,
    });
  });
});
