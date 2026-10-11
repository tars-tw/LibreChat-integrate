import { logger } from '@librechat/data-schemas';
import type { TPrincipal } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { TarsDirectoryCache, TarsDirectoryGroup } from './directory';
import { createTarsDirectoryCache, createTarsDirectorySource } from './directory';
import { isTarsConfigured } from './client';

/** Default seconds between periodic syncs (`permissions.tarsGroupSyncSeconds`). */
export const DEFAULT_TARS_GROUP_SYNC_SECONDS = 120;

/**
 * How long a directory read is reused. Short, because the share dialog should list an
 * account or group created a moment ago; long enough that a burst of dialogs opening
 * costs pwc_tars one fetch.
 */
const DIRECTORY_TTL_MS = 30 * 1000;

/** A LibreChat group mirrored from a pwc_tars user group, as the sync reads it. */
export interface TarsMirroredGroup {
  _id: { toString(): string };
  idOnTheSource?: string;
  name: string;
  description?: string;
  memberIds?: string[];
}

export interface TarsMirroredGroupData {
  name?: string;
  description?: string;
  /** pwc_tars account ids; LibreChat users carry theirs as `idOnTheSource`. */
  memberIds: string[];
}

/** The group storage the sync writes through (data-schemas `userGroup` methods). */
export interface TarsGroupStore {
  findGroupsBySource: (source: 'tars') => Promise<TarsMirroredGroup[]>;
  upsertGroupByExternalId: (
    idOnTheSource: string,
    source: 'tars',
    data: TarsMirroredGroupData,
  ) => Promise<TarsMirroredGroup | null>;
}

export interface TarsGroupSyncDeps {
  directory: TarsDirectoryCache;
  store: TarsGroupStore;
}

function toGroupData(group: TarsDirectoryGroup): TarsMirroredGroupData {
  return {
    name: group.name,
    ...(group.description != null && { description: group.description }),
    memberIds: group.memberIds,
  };
}

function sameMembers(current: string[] | undefined, next: string[]): boolean {
  const members = current ?? [];
  if (members.length !== next.length) {
    return false;
  }
  const sorted = [...members].sort();
  return sorted.every((id, index) => id === next[index]);
}

function needsUpdate(group: TarsMirroredGroup, next: TarsMirroredGroupData): boolean {
  if (!sameMembers(group.memberIds, next.memberIds)) {
    return true;
  }
  if (next.name != null && next.name !== group.name) {
    return true;
  }
  return next.description != null && next.description !== (group.description ?? '');
}

/**
 * Brings every pwc_tars group that has been shared with (and so mirrored into
 * LibreChat) in line with pwc_tars: members are its active accounts, and a group
 * that was disabled or deleted there is left with no members, so its shares reach
 * no one. Skips the pwc_tars call entirely while nothing has been shared to a group.
 */
export async function syncTarsGroups(
  deps: TarsGroupSyncDeps,
): Promise<{ checked: number; updated: number }> {
  const mirrored = await deps.store.findGroupsBySource('tars');
  if (mirrored.length === 0) {
    return { checked: 0, updated: 0 };
  }

  const directory = await deps.directory.refresh();
  const sourceGroups = new Map(directory.groups.map((group) => [group.id, group]));
  let updated = 0;
  for (const group of mirrored) {
    if (!group.idOnTheSource) {
      continue;
    }
    const sourceGroup = sourceGroups.get(group.idOnTheSource);
    const next: TarsMirroredGroupData = sourceGroup ? toGroupData(sourceGroup) : { memberIds: [] };
    if (!needsUpdate(group, next)) {
      continue;
    }
    await deps.store.upsertGroupByExternalId(group.idOnTheSource, 'tars', next);
    updated += 1;
  }
  return { checked: mirrored.length, updated };
}

/**
 * Resolves a pwc_tars group picked in the share dialog to its LibreChat group,
 * mirroring it (with its current members) the first time it is shared with.
 * @returns The LibreChat group id the ACL entry should reference
 */
export async function ensureTarsGroupPrincipal(
  principal: Pick<TPrincipal, 'idOnTheSource'>,
  deps: TarsGroupSyncDeps,
): Promise<string> {
  const groupId = principal.idOnTheSource;
  if (!groupId) {
    throw new Error('pwc_tars group principals must have idOnTheSource');
  }
  const directory = await deps.directory.get();
  const group = directory.groups.find((candidate) => candidate.id === groupId);
  if (!group) {
    throw new Error(`pwc_tars group ${groupId} does not exist or is disabled`);
  }
  const saved = await deps.store.upsertGroupByExternalId(groupId, 'tars', toGroupData(group));
  if (!saved) {
    throw new Error(`Failed to mirror pwc_tars group ${groupId}`);
  }
  return saved._id.toString();
}

export interface TarsGroupSyncScheduler {
  /** Starts the periodic sync; `intervalMs <= 0` leaves only on-demand runs. */
  start: (intervalMs: number) => void;
  /** Runs a sync soon, coalescing bursts (e.g. a bulk user edit) into one run. */
  request: () => void;
  stop: () => void;
}

/**
 * Drives `run` on an interval (leader only, so a multi-instance deployment calls
 * pwc_tars once per tick) and on request after admin edits. Never overlaps runs:
 * a request that lands mid-run schedules exactly one more.
 */
export function createTarsGroupSyncScheduler(deps: {
  run: () => Promise<unknown>;
  isLeader: () => Promise<boolean>;
  debounceMs?: number;
}): TarsGroupSyncScheduler {
  const debounceMs = deps.debounceMs ?? 1000;
  let timer: ReturnType<typeof setInterval> | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | undefined;
  let rerun = false;

  const execute = (): void => {
    if (running) {
      rerun = true;
      return;
    }
    const current = deps
      .run()
      .then(() => undefined)
      .catch((error) => {
        logger.error('[tarsGroupSync] pwc_tars group sync failed:', error);
      })
      .finally(() => {
        running = undefined;
        if (rerun) {
          rerun = false;
          execute();
        }
      });
    running = current;
  };

  const tick = (): void => {
    deps
      .isLeader()
      .then((leader) => {
        if (leader) {
          execute();
        }
      })
      .catch((error) => {
        logger.error('[tarsGroupSync] leader check failed:', error);
      });
  };

  return {
    start: (intervalMs) => {
      if (timer != null || intervalMs <= 0) {
        return;
      }
      tick();
      timer = setInterval(tick, intervalMs);
      timer.unref?.();
    },
    request: () => {
      if (debounce != null) {
        clearTimeout(debounce);
      }
      debounce = setTimeout(() => {
        debounce = undefined;
        execute();
      }, debounceMs);
      debounce.unref?.();
    },
    stop: () => {
      if (timer != null) {
        clearInterval(timer);
        timer = undefined;
      }
      if (debounce != null) {
        clearTimeout(debounce);
        debounce = undefined;
      }
    },
  };
}

/** The periodic sync interval from `permissions.tarsGroupSyncSeconds`; `0` disables it. */
export function getTarsGroupSyncIntervalMs(appConfig?: Pick<AppConfig, 'config'>): number {
  const seconds = appConfig?.config?.permissions?.tarsGroupSyncSeconds;
  return (seconds ?? DEFAULT_TARS_GROUP_SYNC_SECONDS) * 1000;
}

export interface TarsSharing {
  directory: TarsDirectoryCache;
  isEnabled: () => boolean;
  /** Share-dialog grant to a pwc_tars group; returns the LibreChat group id. */
  ensureGroupPrincipal: (principal: Pick<TPrincipal, 'idOnTheSource'>) => Promise<string>;
  /** Called after admin edits to users or groups so shares follow within seconds. */
  requestSync: () => void;
  /** Links pwc_tars users to their account id, then starts the periodic sync. */
  start: (appConfig?: Pick<AppConfig, 'config'>) => Promise<void>;
}

/**
 * Sharing with pwc_tars users and groups: the directory the share dialog lists, the
 * mirror of each shared-with group, and the sync that keeps those mirrors' members in
 * line with pwc_tars (periodically, and right after admin edits made in LibreChat).
 */
export function createTarsSharing(deps: {
  store: TarsGroupStore;
  linkUserSourceIds: () => Promise<number>;
  isLeader: () => Promise<boolean>;
  runAsSystem: <T>(fn: () => Promise<T>) => Promise<T>;
  baseUrl?: string;
}): TarsSharing {
  const isEnabled = () => isTarsConfigured(deps.baseUrl);
  const directory = createTarsDirectoryCache(
    createTarsDirectorySource(deps.baseUrl),
    DIRECTORY_TTL_MS,
  );
  const syncDeps: TarsGroupSyncDeps = { directory, store: deps.store };
  const scheduler = createTarsGroupSyncScheduler({
    isLeader: deps.isLeader,
    run: () => deps.runAsSystem(() => syncTarsGroups(syncDeps)),
  });

  return {
    directory,
    isEnabled,
    ensureGroupPrincipal: (principal) => ensureTarsGroupPrincipal(principal, syncDeps),
    requestSync: () => {
      if (isEnabled()) {
        scheduler.request();
      }
    },
    start: async (appConfig) => {
      if (!isEnabled()) {
        return;
      }
      try {
        const linked = await deps.runAsSystem(deps.linkUserSourceIds);
        if (linked > 0) {
          logger.info(`[tarsGroupSync] Linked ${linked} user(s) to their pwc_tars account id`);
        }
      } catch (error) {
        logger.error('[tarsGroupSync] Failed to link users to their pwc_tars account id:', error);
      }
      scheduler.start(getTarsGroupSyncIntervalMs(appConfig));
    },
  };
}
