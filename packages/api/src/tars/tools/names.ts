import {
  AgentCapabilities,
  TARS_SWITCH_TOOLS,
  TARS_TOOL_SWITCHES,
  isTarsBuiltinToolName,
} from 'librechat-data-provider';
import type { TEphemeralAgent, TTarsBuiltinToolName } from 'librechat-data-provider';
import { isTarsConfigured } from '~/tars/client';

export type TarsToolToggles = Pick<
  TEphemeralAgent,
  'sql_agent' | 'rag_agent' | 'chart_agent' | 'file_agent'
>;

const KNOWLEDGE_TOOL: TTarsBuiltinToolName = 'tars_knowledge_search';
const SPREADSHEET_TOOLS: TTarsBuiltinToolName[] = ['tars_data_schema', 'tars_data_query'];
const TABLE_TASK_TOOL: TTarsBuiltinToolName = 'tars_table_task';

/** The tool whose presence on a turn means the chat switched the database on. */
export const TARS_DATABASE_SWITCH_TOOL: TTarsBuiltinToolName = 'tars_sql_query';

/**
 * The librechat.yaml capability each tool additionally needs — the one its
 * chat switch belongs to, so a switch the deployment disabled reaches nothing
 * through the direct tools either. The row-by-row task searches the knowledge
 * bases, so it follows knowledge search. Tools absent here are gated by TARS
 * alone.
 */
const TOOL_CAPABILITIES: Partial<Record<TTarsBuiltinToolName, AgentCapabilities>> = {
  tars_knowledge_search: AgentCapabilities.rag_agent,
  tars_table_task: AgentCapabilities.rag_agent,
  tars_sql_schema: AgentCapabilities.sql_agent,
  tars_sql_query: AgentCapabilities.sql_agent,
  tars_create_chart: AgentCapabilities.chart_agent,
  tars_generate_file: AgentCapabilities.file_agent,
};

export function tarsBuiltinToolCapability(toolName: string): AgentCapabilities | undefined {
  return isTarsBuiltinToolName(toolName) ? TOOL_CAPABILITIES[toolName] : undefined;
}

/** The pwc_tars tools the chat's switches put on a turn, each switch on its own. */
export function tarsToolsForToggles(toggles?: TarsToolToggles | null): TTarsBuiltinToolName[] {
  return TARS_TOOL_SWITCHES.filter((name) => toggles?.[name] === true).flatMap(
    (name) => TARS_SWITCH_TOOLS[name],
  );
}

/**
 * Whether a saved agent may persist this tool. pwc_tars's built-ins are native
 * tools rather than manifest entries, so the agent save filter would otherwise
 * drop them; the per-turn capability and scope gates still run in ToolService.
 */
export function isPersistableTarsTool(toolName: string | undefined | null): boolean {
  return isTarsBuiltinToolName(toolName) && isTarsConfigured();
}

/**
 * Adds the spreadsheet tools for a conversation whose memory holds csv / xlsx
 * files. The row-by-row task only makes sense against knowledge bases, so it
 * comes along only when knowledge search is already on the turn.
 */
export function withTarsSpreadsheetTools(tools: readonly string[]): string[] {
  const next = new Set(tools);
  for (const tool of SPREADSHEET_TOOLS) {
    next.add(tool);
  }
  if (next.has(KNOWLEDGE_TOOL)) {
    next.add(TABLE_TASK_TOOL);
  }
  return [...next];
}
