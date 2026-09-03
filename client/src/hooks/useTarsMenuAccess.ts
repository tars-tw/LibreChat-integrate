import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { SystemRoles } from 'librechat-data-provider';
import type { AdminMenuNode } from '~/components/Nav/Tars/AdminMenu';
import { ADMIN_MENU_TREE } from '~/components/Nav/Tars/AdminMenu';
import { useAuthContext } from '~/hooks/AuthContext';

type MenuPathEntry = { key: string; path: string };

/** Every leaf's {key, path}, longest path first so nested routes prefix-match their listing page. */
function collectMenuPaths(nodes: AdminMenuNode[]): MenuPathEntry[] {
  const entries: MenuPathEntry[] = [];
  const walk = (items: AdminMenuNode[]) => {
    for (const item of items) {
      if (item.children?.length) {
        walk(item.children);
        continue;
      }
      if (item.key != null && item.path != null) {
        entries.push({ key: item.key, path: item.path });
      }
    }
  };
  walk(nodes);
  return entries.sort((a, b) => b.path.length - a.path.length);
}

const MENU_PATH_ENTRIES = collectMenuPaths(ADMIN_MENU_TREE);

/**
 * The current user's pwc_tars admin-menu access. A tars admin (`role_id` in
 * `TARS_ADMIN_ROLE_IDS`) always has full access; every other tars user is
 * limited to the LibreChat menu keys their role(s) were granted
 * (`user.tarsAdminMenuKeys`, a union resolved at login) — unset or empty means
 * no admin-menu access at all, matching today's default before any role is
 * explicitly configured.
 */
export function useTarsAdminAccess() {
  const { user } = useAuthContext();
  const isTarsAdmin = user?.role === SystemRoles.ADMIN && user?.provider === 'tars';
  const grantedKeys = useMemo(
    () => new Set(user?.tarsAdminMenuKeys ?? []),
    [user?.tarsAdminMenuKeys],
  );

  const hasKey = (key?: string | null): boolean => isTarsAdmin || (!!key && grantedKeys.has(key));
  const hasAny = isTarsAdmin || grantedKeys.size > 0;

  return { isTarsAdmin, hasKey, hasAny, grantedKeys };
}

/**
 * Whether the current route is covered by the user's admin-menu access.
 * Matches the pathname against `ADMIN_MENU_TREE` leaf paths (longest prefix
 * wins, so a detail route like `/knowledge-bases/:id` resolves to its listing
 * page's key). A path absent from the tree defaults to admin-only, preserving
 * today's behavior for pages not yet represented in the permission editor.
 */
export function useHasTarsRouteAccess(): boolean {
  const { pathname } = useLocation();
  const { isTarsAdmin, hasKey } = useTarsAdminAccess();
  if (isTarsAdmin) {
    return true;
  }
  const match = MENU_PATH_ENTRIES.find(
    (entry) => pathname === entry.path || pathname.startsWith(`${entry.path}/`),
  );
  return match != null && hasKey(match.key);
}
