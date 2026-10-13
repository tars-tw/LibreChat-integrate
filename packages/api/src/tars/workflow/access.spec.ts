import type { TarsAccount, TarsUserGroup } from '~/tars/users';
import {
  isWorkflowAdmin,
  workflowStanding,
  createWorkflowAccessCache,
  buildWorkflowAccessDirectory,
} from './access';

const account = (id: string, overrides: Partial<TarsAccount> = {}): TarsAccount => ({
  id,
  username: id,
  email: null,
  role_id: 109,
  user_group_id: null,
  display_name: null,
  status: 'active',
  ...overrides,
});

const group = (id: string, roleIds: string, status = 1): TarsUserGroup => ({
  id,
  name: id,
  role_id: roleIds,
  status,
});

const roles = [
  { id: 1, librechat_menu_keys: '' },
  { id: 109, librechat_menu_keys: 'kb.list' },
  { id: 200, librechat_menu_keys: 'kb.list, admin.langflow' },
  { id: 300, librechat_menu_keys: null },
];

describe('Workflow standing (mirrors pwc_tars login)', () => {
  const directory = buildWorkflowAccessDirectory(
    [
      account('root', { role_id: 1 }),
      account('by-role', { role_id: 200 }),
      account('by-group', { user_group_id: 'g-plain, g-workflow' }),
      account('by-disabled-group', { user_group_id: 'g-off' }),
      account('without', { user_group_id: 'g-plain' }),
      account('disabled', { role_id: 200, status: 'inactive' }),
    ],
    [group('g-plain', '300'), group('g-workflow', '109,200'), group('g-off', '200', 0)],
    roles,
  );

  it.each([
    ['root', 'granted'],
    ['by-role', 'granted'],
    ['by-group', 'granted'],
    ['by-disabled-group', 'granted'],
    ['without', 'revoked'],
    ['disabled', 'disabled'],
    ['gone', 'deleted'],
  ])('%s is %s', (tarsId, standing) => {
    expect(workflowStanding(tarsId, directory)).toBe(standing);
  });

  it('knows an admin only while their account is active', () => {
    expect(isWorkflowAdmin('root', directory)).toBe(true);
    expect(isWorkflowAdmin('by-role', directory)).toBe(false);
    expect(isWorkflowAdmin('gone', directory)).toBe(false);
  });
});

describe('Workflow access cache', () => {
  it('answers from one read until the TTL passes, and refresh always reads', async () => {
    const directory = buildWorkflowAccessDirectory([], [], []);
    const load = jest.fn().mockResolvedValue(directory);
    const cache = createWorkflowAccessCache(load, 60_000);

    await cache.get();
    await cache.get();
    expect(load).toHaveBeenCalledTimes(1);

    await cache.refresh();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
