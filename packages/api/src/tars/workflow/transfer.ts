import { logger } from '@librechat/data-schemas';
import type { AppConfig } from '@librechat/data-schemas';
import type { WorkflowAccount, WorkflowTransferResult } from './service';
import type { WorkflowAgentSyncDeps } from '~/langflow/sync';
import type { WorkflowAccessDirectory } from './access';
import { resolveLangflowOrigin, fetchWorkflowAccounts, requestWorkflowTransfer } from './service';
import { loadWorkflowAccessDirectory, workflowStanding } from './access';
import { createTarsGroupSyncScheduler } from '~/tars/groupSync';
import { removePersonalWorkflowAgents } from '~/langflow/sync';
import { resolveWorkflowTicketSecret } from './ticket';
import { isTarsConfigured } from '~/tars/client';

/** Default seconds between periodic sweeps (`permissions.tarsWorkflowTransferSeconds`). */
export const DEFAULT_WORKFLOW_TRANSFER_SECONDS = 600;

export interface WorkflowSweepDeps {
  readSecret: () => string | null;
  readOrigin: () => string | null;
  fetchAccounts: (origin: string, secret: string) => Promise<WorkflowAccount[]>;
  /** pwc_tars's complete user list (every status), groups and roles. Throws when unreachable. */
  loadDirectory: () => Promise<WorkflowAccessDirectory>;
  transfer: (
    origin: string,
    secret: string,
    tarsId: string,
    request: { label: string; deactivate: boolean },
  ) => Promise<WorkflowTransferResult>;
  /** Removes the user's personal Workflow agents; returns how many there were. */
  removePersonalAgents: (tarsId: string) => Promise<number>;
}

export interface WorkflowSweepResult {
  checked: number;
  transferred: number;
}

/**
 * Hands the flows of everyone who has lost Workflow to the system account. Checks each Langflow
 * account linked to a pwc_tars user against pwc_tars as it stands now: a revoked grant or a
 * disabled account hands the flows over; a deleted account also has its Langflow account
 * deactivated. Then their personal Workflow agents are removed from LibreChat.
 *
 * "Deleted" means absent from pwc_tars's full user list, so the sweep does nothing at all unless
 * that list was read in full: an unreachable pwc_tars, or one answering with no users, must never
 * read as everyone having been deleted.
 */
export async function sweepWorkflowAccounts(deps: WorkflowSweepDeps): Promise<WorkflowSweepResult> {
  const secret = deps.readSecret();
  const origin = deps.readOrigin();
  if (!secret || !origin) {
    return { checked: 0, transferred: 0 };
  }
  const accounts = await deps.fetchAccounts(origin, secret);
  if (accounts.length === 0) {
    return { checked: 0, transferred: 0 };
  }
  const directory = await deps.loadDirectory();
  if (directory.users.size === 0) {
    logger.warn('[workflowTransfer] pwc_tars listed no users; skipping the sweep');
    return { checked: 0, transferred: 0 };
  }

  let transferred = 0;
  for (const account of accounts) {
    const standing = workflowStanding(account.tarsId, directory);
    if (standing === 'granted') {
      continue;
    }
    const user = directory.users.get(account.tarsId);
    const label = user?.display_name || user?.username || account.username;
    try {
      const result = await deps.transfer(origin, secret, account.tarsId, {
        label,
        deactivate: standing === 'deleted',
      });
      const removed = await deps.removePersonalAgents(account.tarsId);
      if (result.moved > 0 || result.deactivated || removed > 0) {
        transferred += 1;
        logger.info(
          `[workflowTransfer] ${label} (${account.tarsId}) is ${standing}: moved ${result.moved} flow(s)` +
            `${result.project ? ` to "${result.project}"` : ''}, removed ${removed} agent(s)` +
            `${result.deactivated ? ', deactivated the Langflow account' : ''}`,
        );
      }
    } catch (error) {
      logger.error(`[workflowTransfer] Could not hand over the flows of ${account.tarsId}:`, error);
    }
  }
  return { checked: accounts.length, transferred };
}

/** The periodic sweep interval from `permissions.tarsWorkflowTransferSeconds`; `0` disables it. */
export function getWorkflowTransferIntervalMs(appConfig?: Pick<AppConfig, 'config'>): number {
  const seconds = appConfig?.config?.permissions?.tarsWorkflowTransferSeconds;
  return (seconds ?? DEFAULT_WORKFLOW_TRANSFER_SECONDS) * 1000;
}

export interface WorkflowTransfer {
  /** Starts the periodic sweep (leader only). */
  start: (appConfig?: Pick<AppConfig, 'config'>) => void;
  /** Sweeps soon, after an admin edit to users, groups or roles that may have revoked Workflow. */
  requestSweep: () => void;
  stop: () => void;
}

export function createWorkflowTransfer(deps: {
  isLeader: () => Promise<boolean>;
  runAsSystem: <T>(fn: () => Promise<T>) => Promise<T>;
  /** The LibreChat user linked to a pwc_tars account. */
  findUserByTarsId: (tarsId: string) => Promise<{ _id: { toString(): string } } | null>;
  agents: Pick<WorkflowAgentSyncDeps, 'getAgents' | 'deleteAgent'>;
  baseUrl?: string;
}): WorkflowTransfer {
  const sweepDeps: WorkflowSweepDeps = {
    readSecret: () => resolveWorkflowTicketSecret(),
    readOrigin: () => resolveLangflowOrigin(),
    fetchAccounts: fetchWorkflowAccounts,
    loadDirectory: () => loadWorkflowAccessDirectory(deps.baseUrl),
    transfer: requestWorkflowTransfer,
    removePersonalAgents: async (tarsId) => {
      const user = await deps.findUserByTarsId(tarsId);
      return user ? removePersonalWorkflowAgents(deps.agents, user._id.toString()) : 0;
    },
  };
  const isEnabled = () =>
    isTarsConfigured(deps.baseUrl) && !!resolveWorkflowTicketSecret() && !!resolveLangflowOrigin();
  const scheduler = createTarsGroupSyncScheduler({
    label: 'workflowTransfer',
    isLeader: deps.isLeader,
    run: () => deps.runAsSystem(() => sweepWorkflowAccounts(sweepDeps)),
    debounceMs: 3000,
  });
  return {
    start: (appConfig) => {
      if (isEnabled()) {
        scheduler.start(getWorkflowTransferIntervalMs(appConfig));
      }
    },
    requestSweep: () => {
      if (isEnabled()) {
        scheduler.request();
      }
    },
    stop: () => scheduler.stop(),
  };
}
