import { logger } from '@librechat/data-schemas';
import type { Response } from 'express';
import type { WorkflowActAs, WorkflowTicketUser } from './ticket';
import type { TarsActionLogEntry } from '~/tars/syslogs';
import type { ServerRequest } from '~/types/http';
import type { TarsAccessUser } from '~/auth/tars';
import type { WorkflowAccount } from './service';
import type { WorkflowStanding } from './access';
import {
  isWorkflowAdmin,
  workflowStanding,
  WORKFLOW_MENU_KEY,
  createWorkflowAccessCache,
} from './access';
import { resolveWorkflowTicketSecret, signWorkflowTicket } from './ticket';
import { fetchWorkflowAccounts, resolveLangflowOrigin } from './service';
import { canUseTarsAdminPage, isTarsAdminRole } from '~/auth/tars';
import { recordTarsActionLog } from '~/tars/syslogs';

const SYSTEM_ACCOUNT_LABEL = '系統共用帳號';

/** A user's Workflow access as pwc_tars has it now (not as it was when they logged in). */
export interface WorkflowLiveAccess {
  standing: WorkflowStanding;
  isAdmin: boolean;
}

export interface WorkflowHandlerDeps {
  readSecret: () => string | null;
  readOrigin: () => string | null;
  fetchAccounts: (origin: string, secret: string) => Promise<WorkflowAccount[]>;
  recordAudit: (actorTarsId: string, entry: TarsActionLogEntry) => Promise<void>;
  /** Null when pwc_tars cannot answer; the login-time grant decides then. */
  readAccess: (tarsId: string) => Promise<WorkflowLiveAccess | null>;
}

const accessCache = createWorkflowAccessCache();

async function readLiveAccess(tarsId: string): Promise<WorkflowLiveAccess | null> {
  try {
    const directory = await accessCache.get();
    return {
      standing: workflowStanding(tarsId, directory),
      isAdmin: isWorkflowAdmin(tarsId, directory),
    };
  } catch (error) {
    logger.warn(
      `[workflowTicket] pwc_tars could not confirm Workflow access; using the login-time grant: ${(error as Error).message}`,
    );
    return null;
  }
}

const defaultDeps: WorkflowHandlerDeps = {
  readSecret: () => resolveWorkflowTicketSecret(),
  readOrigin: () => resolveLangflowOrigin(),
  fetchAccounts: fetchWorkflowAccounts,
  recordAudit: recordTarsActionLog,
  readAccess: readLiveAccess,
};

/** Reads `{ actAs }` from a ticket request body: absent, a valid target, or `'invalid'`. */
function parseActAs(value: unknown): WorkflowActAs | undefined | 'invalid' {
  if (value == null) {
    return undefined;
  }
  const target = value as { type?: unknown; tarsId?: unknown };
  if (target.type === 'system') {
    return { type: 'system' };
  }
  if (target.type === 'user' && typeof target.tarsId === 'string' && target.tarsId.trim()) {
    return { type: 'user', tarsId: target.tarsId.trim() };
  }
  return 'invalid';
}

const switchAudit = (targetName: string): TarsActionLogEntry => ({
  action_type: 'LOGIN',
  module: 'workflow',
  target_type: 'workspace',
  target_name: targetName,
  description: `以「${targetName}」的身分進入 Workflow`,
});

/**
 * `POST /api/tars/workflow/ticket` (behind `requireJwtAuth`): a fresh one-time ticket for the
 * Workflow iframe. Access is decided by pwc_tars as it stands now — a role or group losing
 * Workflow takes effect without the user logging out — and only falls back to the grant
 * resolved at login when pwc_tars cannot be reached. A pwc_tars admin may pass `{ actAs }` to
 * enter the system account or the workspace of someone who has entered Workflow; every such
 * switch is written to pwc_tars's 系統操作稽核 first, and is refused if it cannot be.
 */
export function createWorkflowTicketHandler(
  overrides: Partial<WorkflowHandlerDeps> = {},
): (req: ServerRequest, res: Response) => Promise<void> {
  const deps = { ...defaultDeps, ...overrides };
  return async (req, res) => {
    const secret = deps.readSecret();
    if (!secret) {
      logger.error('[workflowTicket] TARS_LANGFLOW_SSO_SECRET is unset or too short');
      res.status(503).json({ error: 'Workflow sign-in is not configured' });
      return;
    }

    const user: WorkflowTicketUser & TarsAccessUser = req.user ?? {};
    if (!user.tarsId) {
      res.status(403).json({ error: 'Workflow needs a pwc_tars account' });
      return;
    }
    const live = await deps.readAccess(user.tarsId);
    const allowed = live
      ? live.standing === 'granted'
      : canUseTarsAdminPage(user, [WORKFLOW_MENU_KEY]);
    if (!allowed) {
      res.status(403).json({ error: 'pwc_tars menu access required' });
      return;
    }
    const isAdmin = live ? live.isAdmin : isTarsAdminRole(user.tarsRoleId ?? null);

    const parsed = parseActAs((req.body as { actAs?: unknown } | undefined)?.actAs);
    if (parsed === 'invalid') {
      res
        .status(400)
        .json({ error: 'actAs must be { type: "system" } or { type: "user", tarsId }' });
      return;
    }
    const actAs = parsed?.type === 'user' && parsed.tarsId === user.tarsId ? undefined : parsed;

    if (actAs) {
      if (!isAdmin) {
        res.status(403).json({ error: 'Only a pwc_tars admin can switch Workflow identity' });
        return;
      }
      let targetName = SYSTEM_ACCOUNT_LABEL;
      if (actAs.type === 'user') {
        const origin = deps.readOrigin();
        if (!origin) {
          res.status(503).json({ error: 'Langflow address is not configured' });
          return;
        }
        let accounts: WorkflowAccount[];
        try {
          accounts = await deps.fetchAccounts(origin, secret);
        } catch (error) {
          logger.error('[workflowTicket] Could not list Langflow accounts', error);
          res.status(502).json({ error: 'Failed to reach Langflow' });
          return;
        }
        const target = accounts.find((account) => account.tarsId === actAs.tarsId);
        if (!target) {
          res.status(404).json({ error: 'This user has not entered Workflow yet' });
          return;
        }
        targetName = target.username;
      }
      try {
        await deps.recordAudit(user.tarsId, switchAudit(targetName));
      } catch (error) {
        logger.error('[workflowTicket] Could not audit the identity switch; refusing it', error);
        res.status(502).json({ error: 'Failed to record the identity switch' });
        return;
      }
    }

    res.set('Cache-Control', 'private, no-store');
    res.status(200).json({ ticket: signWorkflowTicket(user, secret, actAs, isAdmin) });
  };
}

/**
 * `GET /api/tars/workflow/accounts` (pwc_tars admins only): the workspaces an admin can switch
 * into — everyone who has entered Workflow, except the admin themselves.
 */
export function createWorkflowAccountsHandler(
  overrides: Partial<WorkflowHandlerDeps> = {},
): (req: ServerRequest, res: Response) => Promise<void> {
  const deps = { ...defaultDeps, ...overrides };
  return async (req, res) => {
    const secret = deps.readSecret();
    const origin = deps.readOrigin();
    if (!secret || !origin) {
      res.status(503).json({ error: 'Workflow sign-in is not configured' });
      return;
    }
    try {
      const accounts = await deps.fetchAccounts(origin, secret);
      res.set('Cache-Control', 'private, no-store');
      res.status(200).json({
        accounts: accounts.filter((account) => account.tarsId !== req.user?.tarsId),
      });
    } catch (error) {
      logger.error('[workflowAccounts] Could not list Langflow accounts', error);
      res.status(502).json({ error: 'Failed to reach Langflow' });
    }
  };
}
