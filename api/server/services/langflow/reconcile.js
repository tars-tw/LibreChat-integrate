const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { logger } = require('@librechat/data-schemas');
const {
  SystemRoles,
  PrincipalType,
  ResourceType,
  AccessRoleIds,
  EModelEndpoint,
} = require('librechat-data-provider');
const { grantPermission } = require('~/server/services/PermissionService');
const db = require('~/models');

const SERVER_NAME = 'langflow';
const MCP_DELIMITER = '_mcp_';
const AGENT_PREFIX = 'Langflow · ';
/** Orchestration provider/model for the generated agents. Env-overridable so other deployments
 *  can route Langflow agents through a different endpoint/model than this instance's defaults. */
const PROVIDER = process.env.LANGFLOW_AGENT_PROVIDER || EModelEndpoint.openAI;
const MODEL = process.env.LANGFLOW_AGENT_MODEL || 'gpt-5.4-mini';
const DEBOUNCE_MS = 8000;
const FETCH_TIMEOUT_MS = 2500;

/** Holds a resolved config once found. Failures are never cached, so a transient error (env/yaml
 *  not ready, Langflow down at boot) is retried on the next call instead of disabling reconcile. */
let cachedConfig = null;
let lastRun = 0;
let inFlight = null;

function configFromUrl(url, apiKey) {
  const parsed = new URL(url);
  const match = parsed.pathname.match(/\/project\/([0-9a-fA-F-]+)/);
  return match ? { origin: parsed.origin, projectId: match[1], apiKey } : null;
}

/**
 * Resolves the Langflow origin + project id + api key. Prefers explicit env vars
 * (LANGFLOW_BASE_URL + LANGFLOW_PROJECT_ID) so it works even when CONFIG_PATH is a remote URL;
 * otherwise derives them from the local librechat.yaml mcpServers.langflow.url.
 */
function resolveLangflowConfig() {
  if (cachedConfig) {
    return cachedConfig;
  }
  const apiKey = process.env.LANGFLOW_API_KEY;
  if (!apiKey) {
    return null;
  }

  const envBase = process.env.LANGFLOW_BASE_URL;
  const envProject = process.env.LANGFLOW_PROJECT_ID;
  if (envBase && envProject) {
    try {
      cachedConfig = { origin: new URL(envBase).origin, projectId: envProject, apiKey };
      return cachedConfig;
    } catch (err) {
      logger.warn('[langflow/reconcile] Invalid LANGFLOW_BASE_URL:', err?.message);
      return null;
    }
  }

  const cfgPath = process.env.CONFIG_PATH || path.resolve(__dirname, '../../../../librechat.yaml');
  if (/^https?:\/\//i.test(cfgPath)) {
    logger.warn(
      '[langflow/reconcile] CONFIG_PATH is a URL; set LANGFLOW_BASE_URL + LANGFLOW_PROJECT_ID to enable reconcile.',
    );
    return null;
  }
  try {
    const cfg = yaml.load(fs.readFileSync(cfgPath, 'utf8'));
    const url = cfg?.mcpServers?.[SERVER_NAME]?.url;
    if (!url) {
      return null;
    }
    cachedConfig = configFromUrl(url, apiKey);
    return cachedConfig;
  } catch (err) {
    logger.warn('[langflow/reconcile] Failed to read librechat.yaml config:', err?.message);
    return null;
  }
}

async function fetchEnabledFlows({ origin, projectId, apiKey }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${origin}/api/v1/mcp/project/${projectId}`, {
      headers: { 'x-api-key': apiKey },
      signal: controller.signal,
    });
    if (!res.ok) {
      return [];
    }
    const body = await res.json();
    return (body.tools ?? []).filter((tool) => tool.mcp_enabled);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Deterministic, stable agent id per flow so concurrent reconciles collide on the unique id index
 *  instead of creating duplicate agents. */
function flowAgentId(actionName) {
  return `agent_${SERVER_NAME}_${String(actionName).replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

function buildAgentData(flow, ownerId) {
  const toolId = `${flow.action_name}${MCP_DELIMITER}${SERVER_NAME}`;
  return {
    id: flowAgentId(flow.action_name),
    name: `${AGENT_PREFIX}${flow.name}`,
    description: flow.description || flow.action_description || '',
    instructions:
      `You are a thin wrapper around the Langflow "${flow.name}" flow. ` +
      `For every user message, call the ${flow.action_name} tool with the user's input ` +
      `and return its result verbatim. Do not answer from your own knowledge.`,
    provider: PROVIDER,
    model: MODEL,
    tools: [toolId],
    mcpServerNames: [SERVER_NAME],
    category: 'general',
    author: ownerId,
  };
}

function isDuplicateKeyError(err) {
  return err?.code === 11000 || /E11000/.test(err?.message || '');
}

async function createSharedAgent(flow, ownerId) {
  const agent = await db.createAgent(buildAgentData(flow, ownerId));
  await grantPermission({
    principalType: PrincipalType.PUBLIC,
    principalId: null,
    resourceType: ResourceType.AGENT,
    resourceId: agent._id,
    accessRoleId: AccessRoleIds.AGENT_VIEWER,
    grantedBy: ownerId,
  });
  return agent;
}

async function resolveOwner() {
  const email = process.env.LANGFLOW_AGENT_OWNER_EMAIL;
  if (email) {
    return db.findUser({ email }, '_id');
  }
  return db.findUser({ role: SystemRoles.ADMIN }, '_id');
}

async function doReconcile() {
  const config = resolveLangflowConfig();
  if (!config) {
    return;
  }

  const flows = await fetchEnabledFlows(config);
  if (!flows.length) {
    return;
  }

  const owner = await resolveOwner();
  if (!owner) {
    logger.warn('[langflow/reconcile] No owner user found; cannot own shared Langflow agents.');
    return;
  }
  const ownerId = owner._id;

  const existing = await db.getAgents({ author: ownerId, name: new RegExp(`^${AGENT_PREFIX}`) });
  const existingNames = new Set(existing.map((a) => a.name));

  const created = [];
  for (const flow of flows) {
    const name = `${AGENT_PREFIX}${flow.name}`;
    if (existingNames.has(name)) {
      continue;
    }
    try {
      await createSharedAgent(flow, ownerId);
      created.push(name);
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        continue;
      }
      logger.error(`[langflow/reconcile] Failed to create agent "${name}":`, err?.message);
    }
  }

  if (created.length) {
    logger.info(
      `[langflow/reconcile] Published ${created.length} shared agent(s): ${created.join(', ')}`,
    );
  }
}

/**
 * Reconcile Langflow flows into shared LibreChat agents. Debounced and single-flighted so it is
 * cheap to call on every agent-list fetch. Never throws — failures are logged and swallowed so the
 * agent list is never blocked.
 */
async function reconcileLangflowAgents() {
  if (Date.now() - lastRun < DEBOUNCE_MS) {
    return;
  }
  if (inFlight) {
    return inFlight;
  }
  inFlight = doReconcile()
    .catch((err) => logger.error('[langflow/reconcile] reconcile failed:', err?.message))
    .finally(() => {
      lastRun = Date.now();
      inFlight = null;
    });
  return inFlight;
}

module.exports = { reconcileLangflowAgents };
