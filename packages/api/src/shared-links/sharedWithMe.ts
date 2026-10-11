import { PermissionBits, PrincipalType, ResourceType } from 'librechat-data-provider';
import type { SharedWithMeLink } from 'librechat-data-provider';

type Principal = { principalType: string; principalId?: unknown };

/** A live shared link with its owner, as data-schemas `getSharedLinksByIds` returns it. */
export interface SharedWithMeLinkRecord {
  id: string;
  shareId: string;
  title: string;
  user: string;
}

export interface SharedWithMeDeps {
  getUserPrincipals: (params: {
    userId: string;
    role?: string | null;
    idOnTheSource?: string | null;
  }) => Promise<Principal[]>;
  findGrantsByPrincipals: (
    principals: Principal[],
    resourceType: string,
    requiredPermBit: number,
  ) => Promise<Array<{ resourceId: string; grantedAt?: Date }>>;
  getSharedLinksByIds: (ids: string[], excludeUser?: string) => Promise<SharedWithMeLinkRecord[]>;
  findUsers: (
    filter: { _id: { $in: string[] } },
    fields: string,
  ) => Promise<Array<{ _id: { toString(): string }; name?: string; username?: string }>>;
}

/** Upper bound on the sidebar list; a recipient rarely has more live shares than this. */
export const SHARED_WITH_ME_LIMIT = 200;

/**
 * The conversations shared with a user by name or through one of their groups, newest
 * share first. Public links and role grants are left out — they are shared with
 * everyone rather than with this user — and so are the user's own links.
 */
export async function listSharedWithMe(
  user: { id: string; role?: string | null; idOnTheSource?: string | null },
  deps: SharedWithMeDeps,
  limit: number = SHARED_WITH_ME_LIMIT,
): Promise<SharedWithMeLink[]> {
  const principals = await deps.getUserPrincipals({
    userId: user.id,
    role: user.role,
    idOnTheSource: user.idOnTheSource ?? null,
  });
  const explicit = principals.filter(
    (principal) =>
      principal.principalType === PrincipalType.USER ||
      principal.principalType === PrincipalType.GROUP,
  );
  const grants = await deps.findGrantsByPrincipals(
    explicit,
    ResourceType.SHARED_LINK,
    PermissionBits.VIEW,
  );

  /** A link reached both directly and through a group dates from its latest grant. */
  const sharedAt = new Map<string, number>();
  for (const grant of grants) {
    const time = grant.grantedAt ? new Date(grant.grantedAt).getTime() : 0;
    if (time >= (sharedAt.get(grant.resourceId) ?? -1)) {
      sharedAt.set(grant.resourceId, time);
    }
  }
  if (sharedAt.size === 0) {
    return [];
  }

  const links = await deps.getSharedLinksByIds([...sharedAt.keys()], user.id);
  const ordered = links
    .sort((a, b) => (sharedAt.get(b.id) ?? 0) - (sharedAt.get(a.id) ?? 0))
    .slice(0, limit);
  const ownerIds = [...new Set(ordered.map((link) => link.user).filter(Boolean))];
  const owners = new Map<string, string>();
  if (ownerIds.length > 0) {
    for (const owner of await deps.findUsers({ _id: { $in: ownerIds } }, 'name username')) {
      const name = owner.name || owner.username;
      if (name) {
        owners.set(owner._id.toString(), name);
      }
    }
  }

  return ordered.map((link) => {
    const time = sharedAt.get(link.id);
    return {
      shareId: link.shareId,
      title: link.title,
      ...(time ? { sharedAt: new Date(time).toISOString() } : {}),
      ...(owners.has(link.user) ? { sharedBy: owners.get(link.user) } : {}),
    };
  });
}
