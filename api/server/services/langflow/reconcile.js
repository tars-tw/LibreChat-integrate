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
const AGENT_ID_PREFIX = `agent_${SERVER_NAME}_`;
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

/** Extracts the Langflow project id from a url path. Works on the raw yaml value too, where the
 *  host segment may still be a `${VITE_LANGFLOW_URL}` placeholder, since only the `/project/<id>`
 *  path is matched (no full-URL parse). */
function projectIdFromUrl(url) {
  const match = typeof url === 'string' ? url.match(/\/project\/([0-9a-fA-F-]+)/) : null;
  return match ? match[1] : null;
}

/** Reads the raw (un-interpolated) `mcpServers.langflow.url` from librechat.yaml. Returns null for
 *  a remote CONFIG_PATH (can't be read from disk) or on any read error. */
function readYamlLangflowUrl() {
  const cfgPath = process.env.CONFIG_PATH || path.resolve(__dirname, '../../../../librechat.yaml');
  if (/^https?:\/\//i.test(cfgPath)) {
    return null;
  }
  try {
    const cfg = yaml.load(fs.readFileSync(cfgPath, 'utf8'));
    return cfg?.mcpServers?.[SERVER_NAME]?.url || null;
  } catch (err) {
    logger.warn('[langflow/reconcile] Failed to read librechat.yaml config:', err?.message);
    return null;
  }
}

/**
 * Resolves the Langflow origin + project id + api key.
 * - origin: from `VITE_LANGFLOW_URL` (the single URL source shared with the frontend iframe);
 *   `LANGFLOW_BASE_URL` is a backward-compatible alias. Falls back to a fully-literal yaml url.
 * - project id: from the yaml url path (its literal id survives the `${VITE_LANGFLOW_URL}` host
 *   placeholder); `LANGFLOW_PROJECT_ID` is an optional override, required only when CONFIG_PATH is
 *   a remote URL (yaml unreadable from disk).
 */
function resolveLangflowConfig() {
  if (cachedConfig) {
    return cachedConfig;
  }
  const apiKey = process.env.LANGFLOW_API_KEY;
  if (!apiKey) {
    return null;
  }

  const envBase = process.env.VITE_LANGFLOW_URL || process.env.LANGFLOW_BASE_URL;
  const yamlUrl = readYamlLangflowUrl();

  let origin = null;
  if (envBase) {
    try {
      origin = new URL(envBase).origin;
    } catch (err) {
      logger.warn('[langflow/reconcile] Invalid VITE_LANGFLOW_URL:', err?.message);
      return null;
    }
  } else if (yamlUrl) {
    try {
      origin = new URL(yamlUrl).origin;
    } catch {
      origin = null;
    }
  }

  const projectId = process.env.LANGFLOW_PROJECT_ID || projectIdFromUrl(yamlUrl);

  if (!origin || !projectId) {
    if (!origin) {
      logger.warn('[langflow/reconcile] Cannot resolve Langflow origin; set VITE_LANGFLOW_URL.');
    }
    return null;
  }

  cachedConfig = { origin, projectId, apiKey };
  return cachedConfig;
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
  return `${AGENT_ID_PREFIX}${String(actionName).replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

/** The fields a flow owns. Kept apart from the rest of the agent so a reconcile can refresh them
 *  on an existing agent without touching the orchestration settings an admin may have tuned
 *  (provider/model), which are seeded once at creation. */
function flowOwnedFields(flow) {
  return {
    name: `${AGENT_PREFIX}${flow.name}`,
    description: flow.description || flow.action_description || '',
    instructions:
      `You are a thin wrapper around the Langflow "${flow.name}" flow. ` +
      `For every user message, call the ${flow.action_name} tool with the user's input ` +
      `and return its result verbatim. Do not answer from your own knowledge.`,
    tools: [`${flow.action_name}${MCP_DELIMITER}${SERVER_NAME}`],
    mcpServerNames: [SERVER_NAME],
  };
}

function buildAgentData(flow, ownerId) {
  return {
    ...flowOwnedFields(flow),
    id: flowAgentId(flow.action_name),
    provider: PROVIDER,
    model: MODEL,
    category: 'general',
    author: ownerId,
  };
}

/** Flow-owned fields whose stored value has drifted, or null when the agent is already in sync. */
function driftedFields(agent, flow) {
  const desired = flowOwnedFields(flow);
  const changes = {};
  for (const [key, value] of Object.entries(desired)) {
    const current = agent[key];
    const same = Array.isArray(value)
      ? Array.isArray(current) &&
        current.length === value.length &&
        value.every((entry, i) => current[i] === entry)
      : current === value;
    if (!same) {
      changes[key] = value;
    }
  }
  return Object.keys(changes).length ? changes : null;
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

  /** Keyed by the agent id, which Langflow's `action_name` keeps stable across a flow rename —
   *  unlike `flow.name`, which is only a display value. */
  const desired = new Map(flows.map((flow) => [flowAgentId(flow.action_name), flow]));
  const existing = await db.getAgents({ author: ownerId, id: new RegExp(`^${AGENT_ID_PREFIX}`) });

  /** First agent seen per desired id; every other row is stale — either a flow that is gone or
   *  MCP-disabled, or a duplicate left behind by an earlier create-only reconcile. */
  const current = new Map();
  const stale = [];
  for (const agent of existing) {
    if (!desired.has(agent.id) || current.has(agent.id)) {
      stale.push(agent);
      continue;
    }
    current.set(agent.id, agent);
  }

  const created = [];
  const renamed = [];
  for (const [id, flow] of desired) {
    const agent = current.get(id);
    if (!agent) {
      try {
        await createSharedAgent(flow, ownerId);
        created.push(`${AGENT_PREFIX}${flow.name}`);
      } catch (err) {
        if (!isDuplicateKeyError(err)) {
          logger.error(
            `[langflow/reconcile] Failed to create agent for "${flow.name}":`,
            err?.message,
          );
        }
      }
      continue;
    }
    const changes = driftedFields(agent, flow);
    if (!changes) {
      continue;
    }
    try {
      await db.updateAgent({ _id: agent._id }, changes, { skipVersioning: true });
      renamed.push(`${agent.name} → ${AGENT_PREFIX}${flow.name}`);
    } catch (err) {
      logger.error(`[langflow/reconcile] Failed to update agent "${agent.name}":`, err?.message);
    }
  }

  const removed = [];
  for (const agent of stale) {
    try {
      await db.deleteAgent({ _id: agent._id });
      removed.push(agent.name);
    } catch (err) {
      logger.error(`[langflow/reconcile] Failed to remove agent "${agent.name}":`, err?.message);
    }
  }

  if (created.length) {
    logger.info(
      `[langflow/reconcile] Published ${created.length} shared agent(s): ${created.join(', ')}`,
    );
  }
  if (renamed.length) {
    logger.info(`[langflow/reconcile] Synced ${renamed.length} agent(s): ${renamed.join(', ')}`);
  }
  if (removed.length) {
    logger.info(
      `[langflow/reconcile] Removed ${removed.length} stale agent(s): ${removed.join(', ')}`,
    );
  }
}

/**
 * Reconcile Langflow flows into shared LibreChat agents: create the missing ones, refresh the
 * flow-owned fields of the rest (a renamed flow keeps its agent instead of growing a second one),
 * and remove agents whose flow is gone or MCP-disabled. Debounced and single-flighted so it is
 * cheap to call on every agent-list fetch. Never throws — failures are logged and swallowed so the
 * agent list is never blocked; a fetch that comes back empty is treated as "Langflow unreachable"
 * and skips the whole pass, so a transient outage never prunes anything.
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
