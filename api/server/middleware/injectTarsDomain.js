const { logger } = require('@librechat/data-schemas');
const {
  isTarsConfigured,
  fetchTarsDomainById,
  tarsSqlDomainHint,
  isTarsSqlAgentSelected,
  isTarsSqlAgentEnabled,
} = require('@librechat/api');

/**
 * When a chat request carries a pwc_tars `domain_id` (a selected 專用腦) and the
 * user has not supplied their own promptPrefix, inject the domain's description
 * as the system prompt. The domain is resolved from the user's authorized
 * domains, so a user can never inject one outside their role grants. When the
 * turn also enabled the SQL agent, the brain's database-backed knowledge bases
 * are appended so the model can address them by id. Non-fatal: any failure
 * falls through to a normal chat.
 */
const injectTarsDomain = async (req, res, next) => {
  try {
    const domainId = req.body?.domain_id;
    const tarsId = req.user?.tarsId;
    if (!domainId || !tarsId || !isTarsConfigured()) {
      return next();
    }

    const wantsDescription = !req.body?.promptPrefix;
    const wantsSqlHint = isTarsSqlAgentEnabled() && isTarsSqlAgentSelected(req.body);
    if (!wantsDescription && !wantsSqlHint) {
      return next();
    }

    const [domain, sqlHint] = await Promise.all([
      wantsDescription ? fetchTarsDomainById(tarsId, domainId) : null,
      wantsSqlHint ? tarsSqlDomainHint(tarsId, domainId) : '',
    ]);
    if (domain?.description) {
      req.body.promptPrefix = domain.description;
    }
    if (sqlHint) {
      req.body.promptPrefix = [req.body.promptPrefix, sqlHint].filter(Boolean).join('\n\n');
    }
    return next();
  } catch (error) {
    logger.error('[injectTarsDomain] Failed to inject pwc_tars domain instructions', error);
    return next();
  }
};

module.exports = injectTarsDomain;
