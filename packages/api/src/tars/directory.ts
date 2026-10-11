import { logger } from '@librechat/data-schemas';
import { PrincipalType } from 'librechat-data-provider';
import type { PrincipalDirectoryResponse, TPrincipalSearchResult } from 'librechat-data-provider';
import type { Request, Response } from 'express';
import type { TarsAccount, TarsUserGroup } from './users';
import { fetchTarsUsers, toTarsPrincipalSearchResult } from './users';
import { tarsFetch, tarsErrorReply } from './client';

/** An enabled pwc_tars user group with the ids of its active members. */
export interface TarsDirectoryGroup {
  id: string;
  name: string;
  description?: string;
  /** pwc_tars account ids, sorted. */
  memberIds: string[];
}

/**
 * Who the share dialog can offer, as pwc_tars sees it right now: every active account
 * and every enabled user group. pwc_tars is the source of truth for both.
 */
export interface TarsDirectory {
  users: TarsAccount[];
  groups: TarsDirectoryGroup[];
}

export interface TarsDirectorySource {
  fetchUsers: () => Promise<TarsAccount[]>;
  fetchGroups: () => Promise<TarsUserGroup[]>;
}

export interface TarsDirectoryCache {
  /** The cached directory, fetched when missing or older than the TTL. */
  get: () => Promise<TarsDirectory>;
  /** Always refetches, so callers that must see a change made a moment ago can. */
  refresh: () => Promise<TarsDirectory>;
}

/** Every pwc_tars user group regardless of status (`filter: {}`), for membership sync. */
export async function fetchTarsAllUserGroups(baseUrl?: string): Promise<TarsUserGroup[]> {
  const data = await tarsFetch<{ data?: TarsUserGroup[] }>(
    '/api/user_settings/get_user_group_by_filter',
    { method: 'POST', body: { filter: {} }, baseUrl },
  );
  return data?.data ?? [];
}

/** pwc_tars stores group status as `1`/`0`; a missing value is the column default, enabled. */
export function isTarsGroupEnabled(group: Pick<TarsUserGroup, 'status'>): boolean {
  const { status } = group;
  return status == null || status === true || Number(status) === 1;
}

/** `sys_user.user_group_id` holds the account's group ids comma separated. */
export function parseTarsGroupIds(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

/**
 * Joins accounts to groups. Only active accounts count as members, and disabled groups
 * are left out entirely, so a share to a disabled group reaches no one.
 */
export function buildTarsDirectory(
  accounts: TarsAccount[],
  groups: TarsUserGroup[],
): TarsDirectory {
  const users = accounts.filter((account) => account.status === 'active');
  const membersByGroup = new Map<string, string[]>();
  for (const user of users) {
    for (const groupId of parseTarsGroupIds(user.user_group_id)) {
      const members = membersByGroup.get(groupId);
      if (members) {
        members.push(user.id);
      } else {
        membersByGroup.set(groupId, [user.id]);
      }
    }
  }

  const directoryGroups: TarsDirectoryGroup[] = [];
  for (const group of groups) {
    if (!isTarsGroupEnabled(group)) {
      continue;
    }
    directoryGroups.push({
      id: group.id,
      name: group.name,
      description: group.description ?? undefined,
      memberIds: [...new Set(membersByGroup.get(group.id) ?? [])].sort(),
    });
  }
  return { users, groups: directoryGroups };
}

/**
 * A TTL cache over the pwc_tars directory. pwc_tars has no search endpoint, so every
 * read is the full account and group lists; concurrent reads share one fetch.
 */
export function createTarsDirectoryCache(
  source: TarsDirectorySource,
  ttlMs: number,
  now: () => number = Date.now,
): TarsDirectoryCache {
  let cached: { directory: TarsDirectory; fetchedAt: number } | undefined;
  let inFlight: Promise<TarsDirectory> | undefined;

  const refresh = (): Promise<TarsDirectory> => {
    if (inFlight) {
      return inFlight;
    }
    const current = Promise.all([source.fetchUsers(), source.fetchGroups()])
      .then(([accounts, groups]) => {
        const directory = buildTarsDirectory(accounts, groups);
        cached = { directory, fetchedAt: now() };
        return directory;
      })
      .finally(() => {
        if (inFlight === current) {
          inFlight = undefined;
        }
      });
    inFlight = current;
    return current;
  };

  const get = (): Promise<TarsDirectory> => {
    if (cached && now() - cached.fetchedAt < ttlMs) {
      return Promise.resolve(cached.directory);
    }
    return refresh();
  };

  return { get, refresh };
}

/** The pwc_tars directory source backed by the live pwc_tars API. */
export function createTarsDirectorySource(baseUrl?: string): TarsDirectorySource {
  return {
    fetchUsers: () => fetchTarsUsers(baseUrl),
    fetchGroups: () => fetchTarsAllUserGroups(baseUrl),
  };
}

export function toTarsGroupPrincipal(group: TarsDirectoryGroup): TPrincipalSearchResult {
  return {
    id: null,
    type: PrincipalType.GROUP,
    name: group.name,
    description: group.description,
    memberCount: group.memberIds.length,
    source: 'tars',
    idOnTheSource: group.id,
  };
}

const byName = (a: TPrincipalSearchResult, b: TPrincipalSearchResult) =>
  a.name.localeCompare(b.name);

/** The directory as share-dialog principals, each list sorted by name. */
export function toPrincipalDirectory(directory: TarsDirectory): PrincipalDirectoryResponse {
  return {
    enabled: true,
    users: directory.users.map(toTarsPrincipalSearchResult).sort(byName),
    groups: directory.groups.map(toTarsGroupPrincipal).sort(byName),
  };
}

/**
 * `GET /api/permissions/directory`: everyone and every group any signed-in user may
 * share with — like an address book, it is not gated by people-picker permissions.
 * Without pwc_tars it answers `enabled: false` so the dialog keeps typed search.
 */
export function createPrincipalDirectoryHandler(deps: {
  isEnabled: () => boolean;
  directory: TarsDirectoryCache;
}): (req: Request, res: Response) => Promise<void> {
  return async (_req, res) => {
    if (!deps.isEnabled()) {
      const empty: PrincipalDirectoryResponse = { enabled: false, users: [], groups: [] };
      res.status(200).json(empty);
      return;
    }
    try {
      const directory = await deps.directory.get();
      res.set('Cache-Control', 'private, no-store');
      res.status(200).json(toPrincipalDirectory(directory));
    } catch (error) {
      logger.error('[principalDirectory] Failed to load the pwc_tars directory', error);
      const reply = tarsErrorReply(error, 'Failed to load users and groups');
      res.status(reply.status).json({ error: reply.error });
    }
  };
}
