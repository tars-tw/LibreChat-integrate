import { AgentCapabilities, defaultAgentCapabilities } from 'librechat-data-provider';
import type { TEphemeralAgent } from 'librechat-data-provider';
import type { TarsMemoryDocument } from '~/tars/memory/client';

/**
 * What one `tars_agent` turn binds into pwc_tars's loop. Mirrors the switches
 * pwc_tars's own chat request carries: knowledge bases, the bound database,
 * the conversation's spreadsheets, and whether charts were asked for. Charts
 * and files are always in pwc_tars's loop; the flag only decides whether the
 * tool advertises them to the outer model.
 */
export interface TarsAgentBindings {
  knowledgeBases: boolean;
  database: boolean;
  chart: boolean;
  documents: TarsMemoryDocument[];
}

export type TarsAgentToggles = Pick<TEphemeralAgent, 'sql_agent' | 'rag_agent' | 'chart_agent'>;

export interface ResolveTarsAgentBindingsParams {
  /** The chat's per-turn switches (`ephemeralAgent`). */
  toggles?: TarsAgentToggles | null;
  /** The conversation's active structured memory files (csv / xlsx). */
  documents?: TarsMemoryDocument[] | null;
  /** The agent capabilities librechat.yaml enables; defaults to all of them. */
  capabilities?: Iterable<string> | null;
}

/**
 * A switch counts only when the matching capability is enabled, so the
 * combined tool never reaches something the individual tool would have been
 * filtered out for.
 */
export function resolveTarsAgentBindings(
  params: ResolveTarsAgentBindingsParams,
): TarsAgentBindings {
  const capabilities = new Set<string>(params.capabilities ?? defaultAgentCapabilities);
  const toggles = params.toggles ?? {};
  return {
    knowledgeBases: toggles.rag_agent === true && capabilities.has(AgentCapabilities.rag_agent),
    database: toggles.sql_agent === true && capabilities.has(AgentCapabilities.sql_agent),
    chart: toggles.chart_agent === true && capabilities.has(AgentCapabilities.chart_agent),
    documents: params.documents ?? [],
  };
}

/** Whether anything at all is bound, i.e. whether `tars_agent` belongs on the turn. */
export function hasTarsAgentBindings(bindings: TarsAgentBindings): boolean {
  return (
    bindings.knowledgeBases || bindings.database || bindings.chart || bindings.documents.length > 0
  );
}
