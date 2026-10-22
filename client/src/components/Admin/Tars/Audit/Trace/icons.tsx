import {
  Puzzle,
  History,
  Sparkles,
  Workflow,
  RefreshCw,
  Lightbulb,
  CircleStop,
  CircleAlert,
  TriangleAlert,
} from 'lucide-react';
import {
  Constants,
  TARS_BUILTIN_TOOLS,
  splitToolCallName,
  isTarsPluginToolName,
  isTarsBuiltinToolName,
  tarsPluginNameFromToolName,
  TARS_TRACE_EVENT,
} from 'librechat-data-provider';
import type { TTarsTraceRow } from 'librechat-data-provider';
import type { LucideIcon } from 'lucide-react';
import type { ToolIconType } from '~/components/Chat/Messages/Content/ToolOutput';
import type { TranslationKeys } from '~/hooks';
import type { Localize } from './layout';
import { TOOL_ICONS, TOOL_LABEL_KEYS } from '~/components/Chat/Messages/Content/TarsTrace';
import { ToolIcon, getToolIconType } from '~/components/Chat/Messages/Content/ToolOutput';
import { getTarsToolCopy } from '~/components/Chat/Messages/Content/tars';
import { labelForRow } from './layout';
import { ownValue } from './values';
import { cn } from '~/utils';

/** The LibreChat name of each pwc_tars built-in, by the name pwc_tars traces it under. */
const BUILTIN_BY_TARS_NAME = new Map<string, string>(
  Object.entries(TARS_BUILTIN_TOOLS).map(([name, tarsName]) => [tarsName, name]),
);

type TraceTool =
  | { icon: LucideIcon; nameKey?: TranslationKeys; name?: string }
  | { iconType: ToolIconType; name: string };

/**
 * How a traced call is named and drawn: the way the chat names and draws the
 * same call, so it reads alike in both places. A pwc_tars built-in reads as its
 * chat card, under its LibreChat or its pwc_tars name; pwc_tars's other agent
 * tools as the chat's trace panel; anything else as LibreChat's own tool row.
 */
function resolveTool(toolName: string): TraceTool {
  const builtin = isTarsBuiltinToolName(toolName) ? toolName : BUILTIN_BY_TARS_NAME.get(toolName);
  if (builtin) {
    const copy = getTarsToolCopy(builtin);
    return { icon: copy.icon, nameKey: copy.name };
  }
  const agentIcon = ownValue(TOOL_ICONS, toolName);
  if (agentIcon) {
    return { icon: agentIcon, nameKey: ownValue(TOOL_LABEL_KEYS, toolName) };
  }
  if (isTarsPluginToolName(toolName)) {
    return { icon: Puzzle, name: tarsPluginNameFromToolName(toolName) };
  }
  if (toolName.includes(Constants.mcp_delimiter)) {
    const [name] = splitToolCallName(toolName);
    return { iconType: 'mcp', name };
  }
  return { iconType: getToolIconType(toolName), name: toolName };
}

/** The call's name as the chat shows it; the stored tool name when it has none. */
export function toolLabel(localize: Localize, toolName: string): string {
  const tool = resolveTool(toolName);
  if ('nameKey' in tool && tool.nameKey) {
    return localize(tool.nameKey);
  }
  return tool.name || toolName;
}

/** A row's name on the chart and in its detail: a tool by {@link toolLabel}, else its event. */
export function rowLabel(localize: Localize, row: TTarsTraceRow): string {
  return row.tool_name ? toolLabel(localize, row.tool_name) : labelForRow(localize, row);
}

const EVENT_ICONS: Record<string, LucideIcon> = {
  [TARS_TRACE_EVENT.thinking]: Lightbulb,
  [TARS_TRACE_EVENT.text]: Sparkles,
  [TARS_TRACE_EVENT.langflowRoute]: Workflow,
};

/** A row's icon; a tool takes the chat's icon for it, and colors follow the surrounding text. */
export function RowIcon({ row, className }: { row: TTarsTraceRow; className?: string }) {
  if (!row.tool_name) {
    const Icon = ownValue(EVENT_ICONS, row.event_type) ?? Sparkles;
    return <Icon className={cn('shrink-0', className)} aria-hidden="true" />;
  }
  const tool = resolveTool(row.tool_name);
  if ('iconType' in tool) {
    return <ToolIcon type={tool.iconType} className={className} />;
  }
  const Icon = tool.icon;
  return <Icon className={cn('shrink-0', className)} aria-hidden="true" />;
}

const STATUS_KIND_ICONS: Record<string, LucideIcon> = {
  limit: CircleStop,
  retry: RefreshCw,
  compact: History,
  warning: TriangleAlert,
};

export function statusKindIcon(kind: string | null | undefined): LucideIcon {
  return ownValue(STATUS_KIND_ICONS, kind) ?? CircleAlert;
}
