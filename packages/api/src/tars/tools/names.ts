import { AgentCapabilities, isTarsBuiltinToolName } from 'librechat-data-provider';
import type { TEphemeralAgent, TTarsBuiltinToolName } from 'librechat-data-provider';

export type TarsToolToggles = Pick<TEphemeralAgent, 'sql_agent' | 'rag_agent' | 'chart_agent'>;

const KNOWLEDGE_TOOLS: TTarsBuiltinToolName[] = ['tars_knowledge_search'];
const DATABASE_TOOLS: TTarsBuiltinToolName[] = ['tars_sql_schema', 'tars_sql_query'];
const CHART_TOOLS: TTarsBuiltinToolName[] = ['tars_create_chart'];
const SPREADSHEET_TOOLS: TTarsBuiltinToolName[] = ['tars_data_schema', 'tars_data_query'];
const FILE_TOOL: TTarsBuiltinToolName = 'tars_generate_file';
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
};

export function tarsBuiltinToolCapability(toolName: string): AgentCapabilities | undefined {
  return isTarsBuiltinToolName(toolName) ? TOOL_CAPABILITIES[toolName] : undefined;
}

/**
 * The pwc_tars tools the chat's switches put on a turn. File generation rides
 * along with any of them, as it does on every pwc_tars chat turn.
 */
export function tarsToolsForToggles(toggles?: TarsToolToggles | null): TTarsBuiltinToolName[] {
  const tools: TTarsBuiltinToolName[] = [];
  if (toggles?.rag_agent === true) {
    tools.push(...KNOWLEDGE_TOOLS);
  }
  if (toggles?.sql_agent === true) {
    tools.push(...DATABASE_TOOLS);
  }
  if (toggles?.chart_agent === true) {
    tools.push(...CHART_TOOLS);
  }
  if (tools.length > 0) {
    tools.push(FILE_TOOL);
  }
  return tools;
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
  next.add(FILE_TOOL);
  if (next.has(KNOWLEDGE_TOOLS[0])) {
    next.add(TABLE_TASK_TOOL);
  }
  return [...next];
}
