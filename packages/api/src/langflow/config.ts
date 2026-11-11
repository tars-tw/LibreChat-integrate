import { logger } from '@librechat/data-schemas';
import {
  sanitizeMCPTitle,
  workflowMcpServerName,
  TARS_WORKFLOW_MCP_SERVER_NAME,
} from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import { workflowProjectName } from './labels';

/** The header that tells Langflow LibreChat has checked who may reach a personal project. */
export const WORKFLOW_ACCESS_HEADER = 'x-tars-workflow-access';
export const WORKFLOW_AGENT_SHARE_ACCESS = 'agent-share';

/** One `mcpServers` entry as librechat.yaml declares it. */
type McpEntry = NonNullable<AppConfig['mcpConfig']>[string];

/** The deprecated aggregate server (every project's flows in one list) the YAML entry names. */
const AGGREGATE_PATH = '/api/v1/tars/mcp/streamable';
const projectPath = (projectId: string) =>
  `/api/v1/tars/mcp/project/${encodeURIComponent(projectId)}/streamable`;
/** The least time between two config reloads a sync asks for. */
const REFRESH_INTERVAL_MS = 60_000;

/** A Langflow project holding a published flow (`GET /api/v1/tars/projects`). */
export interface WorkflowProject {
  projectId: string;
  name: string;
  description: string;
  owner: 'system' | 'personal';
  /** The pwc_tars user a personal project belongs to; null for a shared one. */
  tarsId: string | null;
}

export interface WorkflowMcpConfigDeps {
  /** Every project to register; null while Langflow is not configured. Throws when unreachable. */
  fetchProjects: () => Promise<WorkflowProject[] | null>;
}

/** Each registered project server's owner: a pwc_tars user id, or null for a shared project. */
let owners = new Map<string, string | null>();
/** Project servers left out because their key was already taken; known, so not a reason to reload. */
let skipped = new Set<string>();
/** Whether project servers replaced the aggregate on the last load, even if there were none. */
let perProject = false;
let injectionFailed = false;
let lastRefresh = 0;
/** The last project list Langflow returned, registered again while it cannot answer. */
let lastProjects: WorkflowProject[] | null = null;

/**
 * Whether the last {@link withWorkflowMcpConfig} run failed to reach Langflow, so the caller can
 * schedule a config reload rather than wait for a restart.
 */
export function workflowMcpInjectionFailed(): boolean {
  return injectionFailed;
}

const isAggregateTemplate = (entry: McpEntry | undefined): entry is McpEntry & { url: string } =>
  entry != null &&
  'url' in entry &&
  typeof entry.url === 'string' &&
  entry.url.replace(/\/+$/, '').endsWith(AGGREGATE_PATH);

/**
 * A personal project's entry tells Langflow that LibreChat has checked who may reach it: the
 * owner, or someone the owner shared an agent built on it with (`./access`, run before every
 * connection and call). Langflow serves someone else's personal project only on that word.
 */
function projectHeaders(
  template: McpEntry & { url: string },
  project: WorkflowProject,
): { headers?: Record<string, string | undefined> } {
  if (project.owner !== 'personal') {
    return {};
  }
  const headers = 'headers' in template ? template.headers : undefined;
  return { headers: { ...headers, [WORKFLOW_ACCESS_HEADER]: WORKFLOW_AGENT_SHARE_ACCESS } };
}

function projectEntry(template: McpEntry & { url: string }, project: WorkflowProject): McpEntry {
  const name = workflowMcpServerName(project.projectId);
  return {
    ...template,
    ...projectHeaders(template, project),
    url: template.url.replace(/\/+$/, '').replace(AGGREGATE_PATH, projectPath(project.projectId)),
    title: sanitizeMCPTitle(workflowProjectName(project.name, project.owner), name),
    description: project.description || template.description,
    /** One boot probe per project buys nothing: the headers name the chatting user, so every
     *  connection is per-user anyway. */
    startup: false,
  };
}

/**
 * Splits the YAML `workflow` entry into one MCP server per Langflow project
 * (`workflow_<project>`, titled after the project), so an agent picks up a project's flows as a
 * unit. The entry is the template: every project server keeps its headers and timeout and points
 * at `/api/v1/tars/mcp/project/<id>/streamable` instead of the aggregate. Personal projects are
 * registered for everyone and hidden from all but their owner by
 * {@link filterVisibleWorkflowMcpConfigs}; Langflow refuses them to anyone else regardless.
 *
 * Leaves the config untouched when the entry is not the Langflow aggregate or Langflow is not
 * configured. A Langflow that predates per-project servers (404) keeps the aggregate. An unreachable
 * one registers the projects it last listed, so a reload during a hiccup does not take the project
 * agents' tools away, or the aggregate when it has never answered; either way
 * {@link workflowMcpInjectionFailed} has the caller reload. The owners the visibility filter reads
 * are replaced only once the new list is in, so the config still being served stays filtered while
 * Langflow is asked.
 */
export async function withWorkflowMcpConfig(
  appConfig: AppConfig,
  deps: WorkflowMcpConfigDeps,
): Promise<AppConfig> {
  injectionFailed = false;
  const template = appConfig?.mcpConfig?.[TARS_WORKFLOW_MCP_SERVER_NAME];
  const projects = isAggregateTemplate(template) ? await listProjects(deps) : null;
  if (!isAggregateTemplate(template) || projects == null) {
    publish(new Map(), new Set(), false);
    return appConfig;
  }

  const { [TARS_WORKFLOW_MCP_SERVER_NAME]: _aggregate, ...mcpConfig } = appConfig.mcpConfig ?? {};
  const nextOwners = new Map<string, string | null>();
  const nextSkipped = new Set<string>();
  for (const project of projects) {
    const name = workflowMcpServerName(project.projectId);
    if (mcpConfig[name] != null) {
      nextSkipped.add(name);
      logger.warn(
        `[langflow/config] "${name}" is already taken; project "${project.name}" (${project.projectId}) is not registered`,
      );
      continue;
    }
    mcpConfig[name] = projectEntry(template, project);
    nextOwners.set(name, project.tarsId);
  }
  appConfig.mcpConfig = mcpConfig;
  publish(nextOwners, nextSkipped, true);
  return appConfig;
}

function publish(nextOwners: Map<string, string | null>, nextSkipped: Set<string>, split: boolean) {
  owners = nextOwners;
  skipped = nextSkipped;
  perProject = split;
}

/** The projects to register, or null to keep the aggregate. */
async function listProjects(deps: WorkflowMcpConfigDeps): Promise<WorkflowProject[] | null> {
  try {
    const projects = await deps.fetchProjects();
    lastProjects = projects;
    return projects;
  } catch (error) {
    if ((error as { status?: number }).status === 404) {
      logger.warn(
        '[langflow/config] Langflow has no per-project Workflow servers yet; keeping the aggregate server',
      );
      return null;
    }
    injectionFailed = true;
    logger.warn(
      `[langflow/config] Could not list Langflow projects; ${lastProjects ? 'registering the last list' : 'keeping the aggregate server'}: ${(error as Error).message}`,
    );
    return lastProjects;
  }
}

/**
 * The pwc_tars user a registered project server belongs to: null for a shared project, undefined
 * when `serverName` is not a registered project server.
 */
export function workflowProjectOwner(serverName: string): string | null | undefined {
  return owners.get(serverName);
}

const isVisible = (owner: string | null | undefined, tarsId?: string | null) =>
  owner === undefined || owner === null || owner === tarsId;

/**
 * Drops every other user's personal project servers from a resolved MCP config map. The config is
 * shared by everyone, so a listing that skips this shows each user's project names to all.
 */
export function filterVisibleWorkflowMcpConfigs<T>(
  configs: Record<string, T>,
  tarsId?: string | null,
): Record<string, T> {
  if (owners.size === 0) {
    return configs;
  }
  return Object.fromEntries(
    Object.entries(configs).filter(([name]) => isVisible(owners.get(name), tarsId)),
  );
}

/**
 * Whether the registered project servers no longer match what Langflow publishes to this user (a
 * project gained its first published flow, lost its last, or changed hands), at most once per
 * {@link REFRESH_INTERVAL_MS}: the caller reloads the config, which registers them anew. Never
 * true while the aggregate server is still registered in their place.
 */
export function claimWorkflowConfigRefresh(
  serverNames: Iterable<string>,
  tarsId?: string | null,
  now: number = Date.now(),
): boolean {
  if (!perProject || now - lastRefresh < REFRESH_INTERVAL_MS) {
    return false;
  }
  const expected = new Set(serverNames);
  const registered = new Set(
    [...owners].flatMap(([name, owner]) => (isVisible(owner, tarsId) ? [name] : [])),
  );
  const stale =
    [...expected].some((name) => !registered.has(name) && !skipped.has(name)) ||
    [...registered].some((name) => !expected.has(name));
  if (stale) {
    lastRefresh = now;
  }
  return stale;
}
