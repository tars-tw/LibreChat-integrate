const { logger } = require('@librechat/data-schemas');

const DISCOVER_TIMEOUT_MS = 3000;

/**
 * Lists Langflow projects and returns the sole project's id, or null when discovery can't yield a
 * single unambiguous project. Defensive about the response shape across Langflow versions (bare
 * array vs `{ projects: [...] }`).
 */
async function fetchSoleProjectId(origin, apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISCOVER_TIMEOUT_MS);
  try {
    const res = await fetch(`${origin}/api/v1/projects/`, {
      headers: { 'x-api-key': apiKey },
      signal: controller.signal,
    });
    if (!res.ok) {
      logger.warn(`[langflow/project] Project discovery failed: HTTP ${res.status}`);
      return null;
    }
    const body = await res.json();
    let projects = [];
    if (Array.isArray(body)) {
      projects = body;
    } else if (Array.isArray(body?.projects)) {
      projects = body.projects;
    }
    if (projects.length === 1) {
      return projects[0]?.id ?? null;
    }
    logger.warn(
      `[langflow/project] Expected exactly 1 Langflow project, found ${projects.length}. ` +
        'Set LANGFLOW_PROJECT_ID explicitly to disambiguate.',
    );
    return null;
  } catch (err) {
    logger.warn('[langflow/project] Project discovery error:', err?.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Boot step: resolve the Langflow project id once and expose it as `LANGFLOW_PROJECT_ID` so the MCP
 * url placeholder in librechat.yaml and the reconcile service share a single discovered value. Runs
 * before the app config is first loaded (env interpolation) so the MCP url resolves. No-op when the
 * id is already set explicitly, when Langflow isn't configured, or when discovery can't pin down a
 * single project — callers then simply boot without Langflow until it's reachable and restarted.
 */
async function ensureLangflowProjectId() {
  if (process.env.LANGFLOW_PROJECT_ID) {
    return process.env.LANGFLOW_PROJECT_ID;
  }
  const apiKey = process.env.LANGFLOW_API_KEY;
  const base = process.env.VITE_LANGFLOW_URL || process.env.LANGFLOW_BASE_URL;
  if (!apiKey || !base) {
    return null;
  }
  let origin;
  try {
    origin = new URL(base).origin;
  } catch {
    logger.warn('[langflow/project] Invalid VITE_LANGFLOW_URL; skipping project discovery.');
    return null;
  }
  const projectId = await fetchSoleProjectId(origin, apiKey);
  if (projectId) {
    process.env.LANGFLOW_PROJECT_ID = projectId;
    logger.info(`[langflow/project] Discovered Langflow project id ${projectId}.`);
  }
  return projectId;
}

module.exports = { ensureLangflowProjectId };
