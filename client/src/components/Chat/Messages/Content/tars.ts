import { Tools, tarsBuiltinToolOf } from 'librechat-data-provider';
import { Rows3, Table2, Wrench, BookOpen, Database, FileOutput, ChartColumn } from 'lucide-react';
import type { TAttachment, TTarsBuiltinTool } from 'librechat-data-provider';
import type { LucideIcon } from 'lucide-react';
import type { TOptions } from 'i18next';
import type { TranslationKeys } from '~/hooks';
import parseJsonField from './Parts/parseJsonField';

/**
 * How a directly called pwc_tars built-in tool reads to the user. Shared by its
 * own card (`TarsToolCall`) and by the live header of the activity fold that
 * hides that card while the run streams, so both say the same sentence.
 */
export type TarsToolCopy = {
  icon: LucideIcon;
  /** What the call does, as a noun phrase — the label of a failed call. */
  name: TranslationKeys;
  running: TranslationKeys;
  done: TranslationKeys;
  /** The argument that names what the call does, streamed as its subject. */
  detailArg?: string;
};

const TOOL_COPY: Record<TTarsBuiltinTool, TarsToolCopy> = {
  knowledge_search: {
    icon: BookOpen,
    name: 'com_ui_tars_trace_tool_knowledge_search',
    running: 'com_ui_tars_tool_knowledge_search_running',
    done: 'com_ui_tars_tool_knowledge_search_done',
    detailArg: 'query',
  },
  sql_schema: {
    icon: Database,
    name: 'com_ui_tars_trace_tool_sql_schema',
    running: 'com_ui_tars_tool_sql_schema_running',
    done: 'com_ui_tars_tool_sql_schema_done',
    detailArg: 'tables',
  },
  sql_query: {
    icon: Database,
    name: 'com_ui_tars_trace_tool_sql_query',
    running: 'com_ui_tars_tool_sql_query_running',
    done: 'com_ui_tars_tool_sql_query_done',
    detailArg: 'purpose',
  },
  data_schema: {
    icon: Table2,
    name: 'com_ui_tars_trace_tool_data_schema',
    running: 'com_ui_tars_tool_data_schema_running',
    done: 'com_ui_tars_tool_data_schema_done',
  },
  data_query: {
    icon: Table2,
    name: 'com_ui_tars_trace_tool_data_query',
    running: 'com_ui_tars_tool_data_query_running',
    done: 'com_ui_tars_tool_data_query_done',
    detailArg: 'purpose',
  },
  create_chart: {
    icon: ChartColumn,
    name: 'com_ui_tars_trace_tool_create_chart',
    running: 'com_ui_tars_tool_create_chart_running',
    done: 'com_ui_tars_tool_create_chart_done',
    detailArg: 'instruction',
  },
  generate_file: {
    icon: FileOutput,
    name: 'com_ui_tars_trace_tool_generate_file',
    running: 'com_ui_tars_tool_generate_file_running',
    done: 'com_ui_tars_tool_generate_file_done',
    detailArg: 'title',
  },
  run_table_task: {
    icon: Rows3,
    name: 'com_ui_tars_trace_tool_run_table_task',
    running: 'com_ui_tars_tool_table_task_running',
    done: 'com_ui_tars_tool_table_task_done',
    detailArg: 'instruction',
  },
};

const GENERIC_COPY: TarsToolCopy = {
  icon: Wrench,
  name: 'com_ui_tars_tool_generic_name',
  running: 'com_ui_tars_tool_generic_running',
  done: 'com_ui_tars_tool_generic_done',
};

type ToolArgs = string | Record<string, unknown> | undefined;
type Localize = (phraseKey: TranslationKeys, options?: TOptions) => string;

export function getTarsToolCopy(toolName: string | undefined): TarsToolCopy {
  const builtin = tarsBuiltinToolOf(toolName);
  return builtin ? TOOL_COPY[builtin] : GENERIC_COPY;
}

/** The call's subject — its query, purpose or file name — read from args still streaming in. */
export function getTarsToolDetail(copy: TarsToolCopy, args: ToolArgs): string {
  if (!copy.detailArg) {
    return '';
  }
  const value = parseJsonField(args, copy.detailArg);
  if (copy.detailArg !== 'title' || !value) {
    return value;
  }
  const fileType = parseJsonField(args, 'file_type');
  return fileType ? `${value}.${fileType}` : value;
}

/**
 * The newest progress line a pwc_tars tool reported for this call while it
 * runs (e.g. which rows a table task is on). It rides a live-only `tars_trace`
 * attachment the server upserts in place, so there is at most one per call.
 */
export function getTarsToolProgress(
  attachments: readonly TAttachment[] | undefined,
  toolCallId: string | undefined,
): string | undefined {
  if (!attachments?.length) {
    return undefined;
  }
  for (let index = attachments.length - 1; index >= 0; index -= 1) {
    const attachment = attachments[index];
    const progress =
      attachment.type === Tools.tars_trace ? attachment[Tools.tars_trace]?.progress : undefined;
    if (
      progress &&
      (!toolCallId || !attachment.toolCallId || attachment.toolCallId === toolCallId)
    ) {
      return progress;
    }
  }
  return undefined;
}

/**
 * The one-line status of a running or finished call, e.g. 「正在檢索知識庫 ·
 * 台北 成田 班機」, or while a long call reports progress 「正在逐列處理表格 ·
 * 目前正在處理第 1-5 列，共 20 列…」. Undefined for tools that are not pwc_tars
 * built-ins.
 */
export function getTarsToolLine(
  toolName: string | undefined,
  args: ToolArgs,
  done: boolean,
  localize: Localize,
  progress?: string,
): string | undefined {
  if (!tarsBuiltinToolOf(toolName)) {
    return undefined;
  }
  const copy = getTarsToolCopy(toolName);
  const label = localize(done ? copy.done : copy.running);
  const subject = !done && progress ? progress : getTarsToolDetail(copy, args);
  return subject ? `${label} · ${subject}` : label;
}
