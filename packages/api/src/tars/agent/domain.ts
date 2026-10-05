import { logger } from '@librechat/data-schemas';
import { isAgentsEndpoint, isEphemeralAgentId } from 'librechat-data-provider';
import type { NextFunction, Response } from 'express';
import { fetchTarsDomainById } from '~/tars/domains';
import { isTarsConfigured } from '~/tars/client';

/** The slice of a chat request the binding reads and rewrites. */
export interface TarsAgentDomainRequest {
  body?: {
    endpoint?: string;
    agent_id?: string;
    domain_id?: string | number | null;
  };
  user?: { tarsId?: string };
}

export interface TarsAgentDomainDeps {
  /** The 專用腦 a saved agent is bound to; empty when it follows the chat. */
  getAgentDomainId: (agentId: string) => Promise<string | null | undefined>;
  /** Whether the user may use the brain. Defaults to pwc_tars's role-scoped domain listing. */
  canUseDomain?: (tarsUserId: string, domainId: string) => Promise<boolean>;
}

const canUseTarsDomain = async (tarsUserId: string, domainId: string): Promise<boolean> =>
  (await fetchTarsDomainById(tarsUserId, domainId)) != null;

/**
 * Runs a saved agent's turn against the brain the agent is bound to rather
 * than the chat's. Every TARS consumer downstream (knowledge-base and database
 * scope, plugin allowlist, conversation mirror) reads `req.body.domain_id`, so
 * rewriting it here is the one seam that keeps them in agreement. The brain
 * must be one the acting user may use: an agent can be shared with someone
 * outside its brain's role grants, and that user is refused rather than
 * silently answered out of another brain.
 */
export function createBindTarsAgentDomain(deps: TarsAgentDomainDeps) {
  const canUseDomain = deps.canUseDomain ?? canUseTarsDomain;

  return async (req: TarsAgentDomainRequest, res: Response, next: NextFunction): Promise<void> => {
    const body = req.body;
    const agentId = body?.agent_id;
    if (
      body == null ||
      !agentId ||
      !isAgentsEndpoint(body.endpoint) ||
      isEphemeralAgentId(agentId) ||
      !isTarsConfigured()
    ) {
      return next();
    }

    let domainId: string | null | undefined;
    try {
      domainId = await deps.getAgentDomainId(agentId);
    } catch (error) {
      logger.error('[tars-agent-domain] Could not read the agent brain binding', error);
      return next();
    }
    if (!domainId) {
      return next();
    }

    const tarsUserId = req.user?.tarsId;
    const allowed = tarsUserId
      ? await canUseDomain(tarsUserId, domainId).catch(() => false)
      : false;
    if (!allowed) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'This agent is bound to a specialized brain your account cannot use.',
      });
      return;
    }

    body.domain_id = domainId;
    return next();
  };
}
