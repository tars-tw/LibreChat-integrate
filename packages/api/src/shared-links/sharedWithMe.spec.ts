import { PermissionBits, PrincipalType, ResourceType } from 'librechat-data-provider';
import type { SharedWithMeDeps } from './sharedWithMe';
import { listSharedWithMe } from './sharedWithMe';

const user = { id: 'me', role: 'USER', idOnTheSource: 'tars-me' };

const buildDeps = (overrides: Partial<SharedWithMeDeps> = {}): jest.Mocked<SharedWithMeDeps> =>
  ({
    getUserPrincipals: jest
      .fn()
      .mockResolvedValue([
        { principalType: PrincipalType.USER, principalId: 'me' },
        { principalType: PrincipalType.ROLE, principalId: 'USER' },
        { principalType: PrincipalType.GROUP, principalId: 'group-1' },
        { principalType: PrincipalType.PUBLIC },
      ]),
    findGrantsByPrincipals: jest.fn().mockResolvedValue([]),
    getSharedLinksByIds: jest.fn().mockResolvedValue([]),
    findUsers: jest.fn().mockResolvedValue([]),
    ...overrides,
  }) as jest.Mocked<SharedWithMeDeps>;

describe('listSharedWithMe', () => {
  it('reads only grants made to the user or their groups', async () => {
    const deps = buildDeps();

    await expect(listSharedWithMe(user, deps)).resolves.toEqual([]);

    expect(deps.getUserPrincipals).toHaveBeenCalledWith({
      userId: 'me',
      role: 'USER',
      idOnTheSource: 'tars-me',
    });
    expect(deps.findGrantsByPrincipals).toHaveBeenCalledWith(
      [
        { principalType: PrincipalType.USER, principalId: 'me' },
        { principalType: PrincipalType.GROUP, principalId: 'group-1' },
      ],
      ResourceType.SHARED_LINK,
      PermissionBits.VIEW,
    );
    expect(deps.getSharedLinksByIds).not.toHaveBeenCalled();
  });

  it('lists live links newest share first, excluding the user’s own, with owner names', async () => {
    const deps = buildDeps({
      findGrantsByPrincipals: jest.fn().mockResolvedValue([
        { resourceId: 'link-a', grantedAt: new Date('2026-10-01T00:00:00Z') },
        { resourceId: 'link-b', grantedAt: new Date('2026-10-03T00:00:00Z') },
        /** Same link also reached through a group, more recently. */
        { resourceId: 'link-a', grantedAt: new Date('2026-10-05T00:00:00Z') },
      ]),
      getSharedLinksByIds: jest.fn().mockResolvedValue([
        { id: 'link-b', shareId: 'share-b', title: 'Budget', user: 'owner-2' },
        { id: 'link-a', shareId: 'share-a', title: 'Roadmap', user: 'owner-1' },
      ]),
      findUsers: jest.fn().mockResolvedValue([
        { _id: { toString: () => 'owner-1' }, name: 'Alice' },
        { _id: { toString: () => 'owner-2' }, username: 'bob' },
      ]),
    });

    const links = await listSharedWithMe(user, deps);

    expect(deps.getSharedLinksByIds).toHaveBeenCalledWith(['link-a', 'link-b'], 'me');
    expect(deps.findUsers).toHaveBeenCalledWith(
      { _id: { $in: ['owner-1', 'owner-2'] } },
      'name username',
    );
    expect(links).toEqual([
      {
        shareId: 'share-a',
        title: 'Roadmap',
        sharedAt: '2026-10-05T00:00:00.000Z',
        sharedBy: 'Alice',
      },
      {
        shareId: 'share-b',
        title: 'Budget',
        sharedAt: '2026-10-03T00:00:00.000Z',
        sharedBy: 'bob',
      },
    ]);
  });

  it('caps the list at the given limit', async () => {
    const deps = buildDeps({
      findGrantsByPrincipals: jest.fn().mockResolvedValue([
        { resourceId: 'l1', grantedAt: new Date('2026-10-01T00:00:00Z') },
        { resourceId: 'l2', grantedAt: new Date('2026-10-02T00:00:00Z') },
      ]),
      getSharedLinksByIds: jest.fn().mockResolvedValue([
        { id: 'l1', shareId: 's1', title: 'One', user: 'o' },
        { id: 'l2', shareId: 's2', title: 'Two', user: 'o' },
      ]),
    });

    const links = await listSharedWithMe(user, deps, 1);

    expect(links).toEqual([{ shareId: 's2', title: 'Two', sharedAt: '2026-10-02T00:00:00.000Z' }]);
  });
});
