import { logger } from '@librechat/data-schemas';
import {
  isAgentsEndpoint,
  isEphemeralAgentId,
  TARS_AGENT_DOMAIN_FORBIDDEN,
  TARS_AGENT_DOMAIN_CHECK_UNAVAILABLE,
} from 'librechat-data-provider';
import type { TTarsDomainShareGap } from 'librechat-data-provider';
import type { NextFunction, Response } from 'express';
import { fetchTarsDomainShareCheck, toTarsDomainShareGap } from '~/tars/domains';
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

/** Whether a user may use a brain, and the brain as pwc_tars knows it. */
export interface TarsDomainAccess {
  allowed: boolean;
  domain: TTarsDomainShareGap;
}

export interface TarsAgentDomainDeps {
  /** The 專用腦 a saved agent is bound to; empty when it follows the chat. */
  getAgentDomainId: (agentId: string) => Promise<string | null | undefined>;
  /**
   * Whether the user may use the brain. Defaults to pwc_tars's share check for the user
   * alone, so a chat is judged on exactly what sharing the agent was judged on.
   */
  checkDomain?: (tarsUserId: string, domainId: string) => Promise<TarsDomainAccess>;
}

const checkTarsDomain = async (tarsUserId: string, domainId: string): Promise<TarsDomainAccess> => {
  const { domain, missing } = await fetchTarsDomainShareCheck(domainId, [
    { principal_type: 'user', principal_id: tarsUserId },
  ]);
  return { allowed: missing.length === 0, domain: toTarsDomainShareGap(domain) };
};

const refuse = (res: Response, domain?: TTarsDomainShareGap): void => {
  res.status(403).json({
    error: 'Forbidden',
    code: TARS_AGENT_DOMAIN_FORBIDDEN,
    message: 'This agent is bound to a specialized brain your account cannot use.',
    ...(domain ? { domain } : {}),
  });
};

/**
 * Runs a saved agent's turn against the brain the agent is bound to rather
 * than the chat's. Every TARS consumer downstream (knowledge-base and database
 * scope, plugin allowlist, conversation mirror) reads `req.body.domain_id`, so
 * rewriting it here is the one seam that keeps them in agreement. The brain
 * must be one the acting user may use: a share is checked when it is made, but
 * the user's roles, groups or the brain itself can change afterwards, so that
 * user is refused with the brain named rather than silently answered out of
 * another brain.
 */
export function createBindTarsAgentDomain(deps: TarsAgentDomainDeps) {
  const checkDomain = deps.checkDomain ?? checkTarsDomain;

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
    if (!tarsUserId) {
      refuse(res);
      return;
    }

    let access: TarsDomainAccess;
    try {
      access = await checkDomain(tarsUserId, domainId);
    } catch (error) {
      logger.error('[tars-agent-domain] Could not check access to the agent brain', error);
      res.status(503).json({
        error: 'Service Unavailable',
        code: TARS_AGENT_DOMAIN_CHECK_UNAVAILABLE,
        message: 'Could not verify access to the specialized brain this agent is bound to.',
      });
      return;
    }
    if (!access.allowed) {
      refuse(res, access.domain);
      return;
    }

    body.domain_id = domainId;
    return next();
  };
}
