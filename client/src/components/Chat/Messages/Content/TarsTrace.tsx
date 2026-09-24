import { useId, useMemo, useState } from 'react';
import { Tools } from 'librechat-data-provider';
import { Button, disclosureChevronVariants } from '@librechat/client';
import {
  Info,
  Link,
  Brain,
  Globe,
  Users,
  Wrench,
  Table2,
  CircleX,
  BookOpen,
  Database,
  ListTree,
  Workflow,
  FileOutput,
  ListChecks,
  ChevronDown,
  ChartColumn,
  CircleCheck,
  TriangleAlert,
  MessageSquareText,
} from 'lucide-react';
import type {
  TAttachment,
  TTarsTraceJson,
  TTarsTraceEntry,
  TTarsTracePlanItem,
  TTarsTraceArtifact,
} from 'librechat-data-provider';
import type { LucideIcon } from 'lucide-react';
import type { TranslationKeys } from '~/hooks';
import { useLocalize, useExpandCollapse, useLazyCollapseBody } from '~/hooks';
import { toolPanelSpacingClassName } from './disclosure';
import { ROW_GLYPH_SLOT } from './rows';
import ToolCall from './ToolCall';
import { cn } from '~/utils';

/**
 * A pwc_tars capability call (`sql_agent`, `chart_agent`, `data_query`,
 * `table_task`) is one LibreChat tool call whose reply comes from a whole
 * pwc_tars agent run. The run's trace rides back as a `tars_trace` attachment
 * on that call, and this file shows it the way pwc_tars's own chat does:
 * thinking, intermediate notes, each nested tool with its input and output,
 * runtime notices and the plan. The block model below is a port of pwc_tars
 * `agentStreamReducer.traceFromPersisted`, without the live-streaming state
 * a finished run never has.
 */

type TraceToolBlock = {
  kind: 'tool';
  id: string;
  name: string;
  title: string;
  input: Record<string, TTarsTraceJson>;
  ok?: boolean;
  output: string;
  summary: string;
  durationMs?: number;
  truncated: boolean;
  outputLen: number;
  children: TraceToolBlock[];
};

type TraceBlock =
  | TraceToolBlock
  | { kind: 'thinking'; text: string }
  | { kind: 'note'; text: string }
  | { kind: 'status'; status: string; message: string }
  | { kind: 'plan'; items: TTarsTracePlanItem[] };

type TraceView = {
  blocks: TraceBlock[];
  turns: number;
  toolCount: number;
  error?: string;
  clarification?: string;
};

const TOOL_LABEL_KEYS: Record<string, TranslationKeys> = {
  knowledge_search: 'com_ui_tars_trace_tool_knowledge_search',
  sql_schema: 'com_ui_tars_trace_tool_sql_schema',
  sql_query: 'com_ui_tars_trace_tool_sql_query',
  data_schema: 'com_ui_tars_trace_tool_data_schema',
  data_query: 'com_ui_tars_trace_tool_data_query',
  create_chart: 'com_ui_tars_trace_tool_create_chart',
  generate_file: 'com_ui_tars_trace_tool_generate_file',
  web_search: 'com_ui_tars_trace_tool_web_search',
  web_fetch: 'com_ui_tars_trace_tool_web_fetch',
  delegate: 'com_ui_tars_trace_tool_delegate',
  todo_write: 'com_ui_tars_trace_tool_todo_write',
  ask_user: 'com_ui_tars_trace_tool_ask_user',
  langflow_run: 'com_ui_tars_trace_tool_langflow_run',
};

const TOOL_ICONS: Record<string, LucideIcon> = {
  knowledge_search: BookOpen,
  sql_schema: Database,
  sql_query: Database,
  data_schema: Table2,
  data_query: Table2,
  create_chart: ChartColumn,
  generate_file: FileOutput,
  web_search: Globe,
  web_fetch: Link,
  delegate: Users,
  todo_write: ListChecks,
  ask_user: MessageSquareText,
  langflow_run: Workflow,
};

const asText = (value: TTarsTraceJson | undefined): string =>
  typeof value === 'string' ? value : '';

const asStrings = (value: TTarsTraceJson | undefined): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/** The argument that names what a call did, so the row reads as a sentence. */
function toolDetail(block: TraceToolBlock): string {
  const input = block.input;
  switch (block.name) {
    case 'knowledge_search':
    case 'web_search':
    case 'langflow_run':
      return asText(input.query);
    case 'sql_query':
    case 'data_query':
      return asText(input.purpose);
    case 'create_chart':
      return asText(input.instruction);
    case 'generate_file': {
      const title = asText(input.title);
      return title ? `${title}.${asText(input.file_type)}` : '';
    }
    case 'delegate':
      return asText(input.task);
    case 'sql_schema':
      return asStrings(input.tables).join(', ');
    case 'web_fetch': {
      const urls = asStrings(input.urls);
      return urls.length > 1 ? `${urls[0]} (+${urls.length - 1})` : (urls[0] ?? '');
    }
    default:
      return '';
  }
}

function formatDuration(ms: number | undefined): string {
  if (ms == null) {
    return '';
  }
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
}

function newToolBlock(id: string, name: string): TraceToolBlock {
  return {
    kind: 'tool',
    id,
    name,
    title: '',
    input: {},
    output: '',
    summary: '',
    truncated: false,
    outputLen: 0,
    children: [],
  };
}

/** Folds the persisted records into render blocks in one pass. */
function buildTraceView(entries: TTarsTraceEntry[]): TraceView {
  const blocks: TraceBlock[] = [];
  const tools = new Map<string, TraceToolBlock>();
  const view: TraceView = { blocks, turns: 0, toolCount: 0 };

  const placeTool = (block: TraceToolBlock, parentId?: string) => {
    tools.set(block.id, block);
    const parent = parentId ? tools.get(parentId) : undefined;
    if (parent) {
      parent.children.push(block);
      return;
    }
    blocks.push(block);
  };

  for (const entry of entries) {
    switch (entry.type) {
      case 'turn':
        view.turns = Math.max(view.turns, entry.turn);
        break;
      case 'thinking':
        blocks.push({ kind: 'thinking', text: entry.text });
        break;
      case 'text':
        blocks.push({ kind: 'note', text: entry.text });
        break;
      case 'tool_call': {
        const block = newToolBlock(entry.id, entry.name);
        block.title = entry.title ?? '';
        block.input = entry.input ?? {};
        view.toolCount += 1;
        placeTool(block, entry.parent_id);
        break;
      }
      case 'tool_result': {
        let block = tools.get(entry.id);
        if (!block) {
          block = newToolBlock(entry.id, entry.name);
          view.toolCount += 1;
          placeTool(block, entry.parent_id);
        }
        block.ok = entry.ok;
        block.output = entry.output ?? '';
        block.summary = entry.summary ?? '';
        block.durationMs = entry.duration_ms;
        block.truncated = entry.truncated === true;
        block.outputLen = entry.output_len_chars ?? block.output.length;
        break;
      }
      case 'status':
        blocks.push({ kind: 'status', status: entry.kind, message: entry.message });
        break;
      case 'plan': {
        const existing = blocks.findIndex((block) => block.kind === 'plan');
        const plan: TraceBlock = { kind: 'plan', items: entry.items };
        if (existing >= 0) {
          blocks[existing] = plan;
        } else {
          blocks.push(plan);
        }
        break;
      }
      case 'clarification':
        view.clarification = entry.question;
        break;
      case 'error':
        view.error = entry.message;
        break;
      default:
        break;
    }
  }
  return view;
}

const PRE_CLASSES =
  'mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-tertiary p-2 font-mono text-[11px] leading-relaxed text-text-primary';
const ITEM_CLASSES = 'flex items-start gap-2 py-1 text-xs text-text-secondary';
const ITEM_ICON_CLASSES = 'mt-0.5 size-3.5 shrink-0';

function TraceToolCard({ block, depth = 0 }: { block: TraceToolBlock; depth?: number }) {
  const localize = useLocalize();
  const contentId = useId();
  const [open, setOpen] = useState(false);
  const Icon = TOOL_ICONS[block.name] ?? Wrench;
  const labelKey = TOOL_LABEL_KEYS[block.name];
  const detail = toolDetail(block);
  const base = labelKey ? localize(labelKey) : block.title || block.name;
  const label = labelKey && detail ? `${base}: ${detail}` : base;
  const meta = [block.summary, formatDuration(block.durationMs)].filter(Boolean).join(' · ');
  const hasInput = Object.keys(block.input).length > 0;
  const hasOutput = block.output.length > 0;
  const StatusIcon = block.ok === false ? CircleX : CircleCheck;

  return (
    <div className={cn('py-0.5', depth > 0 && 'ml-4 border-l border-border-light pl-2')}>
      <Button
        variant="ghost"
        className="group/disclosure h-auto w-full min-w-0 justify-start gap-2 rounded-md px-1 py-1 text-left text-xs font-normal text-text-primary hover:bg-surface-hover"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-controls={contentId}
      >
        <Icon className="size-3.5 shrink-0 text-text-secondary" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate" title={block.title || block.name}>
          {label}
        </span>
        {meta && <span className="shrink-0 text-[11px] text-text-secondary">{meta}</span>}
        <StatusIcon
          className={cn(
            'size-3.5 shrink-0',
            block.ok === false ? 'text-status-error' : 'text-text-secondary',
          )}
          aria-hidden="true"
        />
        <ChevronDown
          className={cn(disclosureChevronVariants({ expanded: open }), 'size-3.5 shrink-0')}
          aria-hidden="true"
        />
      </Button>
      {block.children.length > 0 && (
        <div className="mt-0.5">
          {block.children.map((child) => (
            <TraceToolCard key={child.id} block={child} depth={depth + 1} />
          ))}
        </div>
      )}
      {open && (
        <div id={contentId} className="px-1 pb-1 text-xs text-text-secondary">
          {hasInput && (
            <section>
              <div className="mt-1 font-medium">{localize('com_ui_tars_trace_tool_input')}</div>
              <pre className={PRE_CLASSES}>{JSON.stringify(block.input, null, 2)}</pre>
            </section>
          )}
          {hasOutput && (
            <section>
              <div className="mt-1 font-medium">
                {localize(
                  block.ok === false
                    ? 'com_ui_tars_trace_tool_error'
                    : 'com_ui_tars_trace_tool_output',
                )}
                {block.truncated && (
                  <span className="font-normal">
                    {' · '}
                    {localize('com_ui_tars_trace_tool_truncated', { count: block.outputLen })}
                  </span>
                )}
              </div>
              <pre className={PRE_CLASSES}>{block.output}</pre>
            </section>
          )}
          {!hasInput && !hasOutput && <div>{localize('com_ui_tars_trace_tool_no_details')}</div>}
        </div>
      )}
    </div>
  );
}

function TraceBlockView({ block }: { block: TraceBlock }) {
  const localize = useLocalize();
  switch (block.kind) {
    case 'tool':
      return <TraceToolCard block={block} />;
    case 'thinking':
      return (
        <details className="py-1 text-xs text-text-secondary">
          <summary className="flex cursor-pointer items-center gap-2">
            <Brain className={ITEM_ICON_CLASSES} aria-hidden="true" />
            {localize('com_ui_tars_trace_thinking')}
          </summary>
          <pre className={PRE_CLASSES}>{block.text}</pre>
        </details>
      );
    case 'note':
      return (
        <div className={ITEM_CLASSES}>
          <MessageSquareText className={ITEM_ICON_CLASSES} aria-hidden="true" />
          <span className="whitespace-pre-wrap break-words">{block.text}</span>
        </div>
      );
    case 'status':
      return (
        <div className={cn(ITEM_CLASSES, block.status === 'warning' && 'text-status-warning')}>
          <Info className={ITEM_ICON_CLASSES} aria-hidden="true" />
          <span>{block.message}</span>
        </div>
      );
    case 'plan':
      return (
        <div className="py-1 text-xs text-text-secondary">
          <div className="flex items-center gap-2 font-medium">
            <ListChecks className={ITEM_ICON_CLASSES} aria-hidden="true" />
            {localize('com_ui_tars_trace_plan')}
          </div>
          <ul className="mt-1 list-disc pl-6">
            {block.items.map((item, index) => (
              <li
                key={`${index}-${item.content ?? ''}`}
                className={cn(item.status === 'done' && 'line-through')}
              >
                {item.content}
              </li>
            ))}
          </ul>
        </div>
      );
    default:
      return null;
  }
}

function TraceDisclosure({ artifact }: { artifact: TTarsTraceArtifact }) {
  const localize = useLocalize();
  const contentId = useId();
  const [open, setOpen] = useState(false);
  const { style, ref } = useExpandCollapse(open);
  const { shouldRenderBody, mountBody, handleTransitionEnd } = useLazyCollapseBody(open);
  const view = useMemo(() => buildTraceView(artifact.trace), [artifact]);

  const summary = useMemo(() => {
    const parts: string[] = [];
    if (view.toolCount > 0) {
      parts.push(localize('com_ui_tars_trace_summary_tools', { count: view.toolCount }));
    }
    if (view.turns > 1) {
      parts.push(localize('com_ui_tars_trace_summary_turns', { count: view.turns }));
    }
    return parts.join(' · ');
  }, [localize, view]);

  const title = localize('com_ui_tars_trace_title');
  const handleToggle = () => {
    mountBody();
    setOpen((prev) => !prev);
  };

  return (
    <div className="my-1" data-testid="tars-trace">
      <div className="relative flex h-5 items-center gap-1.5">
        <Button
          variant="ghost"
          className="tool-status-text group/disclosure h-5 min-w-0 justify-start gap-2 rounded-full p-0 font-normal text-text-secondary transition-none hover:bg-transparent"
          onClick={handleToggle}
          aria-expanded={open}
          aria-controls={contentId}
          aria-label={summary ? `${title} - ${summary}` : title}
        >
          <span className={ROW_GLYPH_SLOT} aria-hidden="true">
            <ListTree className="size-4 shrink-0" />
          </span>
          <span className="min-w-0 truncate font-medium">{title}</span>
          {summary && <span className="text-xs">{summary}</span>}
          <ChevronDown
            className={cn(disclosureChevronVariants({ expanded: open }), 'size-3.5')}
            aria-hidden="true"
          />
        </Button>
      </div>
      <div
        id={contentId}
        style={style}
        onTransitionEnd={handleTransitionEnd}
        role="group"
        aria-label={title}
        aria-hidden={!open || undefined}
      >
        <div className="overflow-hidden" ref={ref}>
          {shouldRenderBody && (
            <div
              className={cn(
                toolPanelSpacingClassName,
                'mt-1.5 rounded-lg border border-border-light bg-surface-secondary px-3 py-2',
              )}
            >
              {view.blocks.map((block, index) => (
                <TraceBlockView key={`${block.kind}-${index}`} block={block} />
              ))}
              {view.error && (
                <div className={cn(ITEM_CLASSES, 'text-status-error')}>
                  <TriangleAlert className={ITEM_ICON_CLASSES} aria-hidden="true" />
                  <span>{view.error}</span>
                </div>
              )}
              {view.clarification && (
                <div className={ITEM_CLASSES}>
                  <MessageSquareText className={ITEM_ICON_CLASSES} aria-hidden="true" />
                  <span>{view.clarification}</span>
                </div>
              )}
              {artifact.sql && (
                <section className="py-1 text-xs text-text-secondary">
                  <div className="flex items-center gap-2 font-medium">
                    <Database className={ITEM_ICON_CLASSES} aria-hidden="true" />
                    {localize('com_ui_tars_trace_sql')}
                  </div>
                  <pre className={PRE_CLASSES}>{artifact.sql}</pre>
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** The trace pwc_tars attached to this tool call, if the reply carried one. */
export function TarsTracePanel({
  attachments,
  toolCallId,
}: {
  attachments?: TAttachment[];
  toolCallId?: string;
}) {
  const artifact = useMemo(
    () =>
      attachments?.find(
        (attachment) =>
          attachment.type === Tools.tars_trace &&
          attachment[Tools.tars_trace] != null &&
          (!toolCallId || !attachment.toolCallId || attachment.toolCallId === toolCallId),
      )?.[Tools.tars_trace],
    [attachments, toolCallId],
  );
  if (!artifact?.trace.length) {
    return null;
  }
  return <TraceDisclosure artifact={artifact} />;
}

type ToolCallProps = Parameters<typeof ToolCall>[0];

/**
 * The generic tool card, with the pwc_tars run trace underneath once it
 * arrives. The trace is part of this call's card, not a file chip, so it is
 * not gated by `hideAttachments`: inside an activity group the members render
 * with that flag while the group hoists file attachments to its own row, and
 * hoisting the trace there would detach it from the call it explains — the
 * same reason `WebSearch` keeps its source list under the flag.
 */
export default function TarsCapabilityCall(props: ToolCallProps) {
  return (
    <>
      <ToolCall {...props} />
      <TarsTracePanel attachments={props.attachments} toolCallId={props.toolCallId} />
    </>
  );
}
