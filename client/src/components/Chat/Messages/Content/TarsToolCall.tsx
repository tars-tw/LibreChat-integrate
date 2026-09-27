import { useMemo, useState, useCallback } from 'react';
import { Tools } from 'librechat-data-provider';
import { FileText, FileOutput } from 'lucide-react';
import type { TAttachment, PartMetadata, TTarsToolStep } from 'librechat-data-provider';
import type { ToolCallPhase } from '~/utils/toolCallPhase';
import type { TranslationKeys } from '~/hooks';
import type { TarsToolCopy } from './tars';
import { useLocalize, useProgress, useExpandCollapse, useLazyCollapseBody } from '~/hooks';
import { getTarsToolCopy, getTarsToolDetail, getTarsToolProgress } from './tars';
import { resolveToolCallPhase } from '~/utils/toolCallPhase';
import { toolPanelSpacingClassName } from './disclosure';
import parseJsonField from './Parts/parseJsonField';
import ProgressText from './ProgressText';
import MarkdownLite from './MarkdownLite';
import { TOOL_ROW_CLASSES } from './rows';
import { cn } from '~/utils';

/**
 * One directly called pwc_tars built-in tool (`tars_knowledge_search`,
 * `tars_sql_query`, ...). Each step of the answer is its own call now, so the
 * card reads as a sentence while it streams — "Searching the knowledge base:
 * 台北 成田 班機" — then settles with what came back: the files a search read,
 * the SQL and its rows, the chart or file it produced.
 */

/** pwc_tars summaries are fixed English phrases (`9 chunks`, `12 rows`); the known ones are localized. */
const SUMMARY_KEYS: Record<string, TranslationKeys> = {
  chunk: 'com_ui_tars_tool_summary_chunks',
  row: 'com_ui_tars_tool_summary_rows',
  table: 'com_ui_tars_tool_summary_tables',
  file: 'com_ui_tars_tool_summary_files',
};

const SUMMARY_PATTERN = /^(\d+)\s+(chunk|row|table|file)s?$/i;
const MARKDOWN_TABLE = /^\s*\|.+\|\s*$/m;
const PRE_CLASSES =
  'max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-tertiary p-2 font-mono text-xs leading-relaxed text-text-primary';
const SECTION_TITLE_CLASSES = 'mb-1 text-xs font-medium text-text-secondary';

function labelKeyFor(copy: TarsToolCopy, phase: ToolCallPhase): TranslationKeys {
  if (phase === 'running') {
    return copy.running;
  }
  return phase === 'failed' ? copy.name : copy.done;
}

function useSummaryText(step: TTarsToolStep | undefined): string {
  const localize = useLocalize();
  return useMemo(() => {
    const summary = step?.summary?.trim() ?? '';
    const match = SUMMARY_PATTERN.exec(summary);
    const parts: string[] = [];
    if (match) {
      parts.push(localize(SUMMARY_KEYS[match[2].toLowerCase()], { count: Number(match[1]) }));
    } else if (summary) {
      parts.push(summary);
    }
    if (step?.sources?.length) {
      parts.push(localize('com_ui_tars_tool_summary_files', { count: step.sources.length }));
    }
    return parts.join(' · ');
  }, [localize, step]);
}

function SourceList({ step }: { step: TTarsToolStep }) {
  const localize = useLocalize();
  if (!step.sources?.length) {
    return null;
  }
  return (
    <section>
      <div className={SECTION_TITLE_CLASSES}>{localize('com_ui_tars_tool_sources')}</div>
      <ul className="space-y-1">
        {step.sources.map((source) => (
          <li key={source.filename}>
            <details className="group rounded-md text-xs text-text-primary">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-1 py-0.5 hover:bg-surface-hover">
                <FileText className="size-3.5 shrink-0 text-text-secondary" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate" title={source.filename}>
                  {source.filename}
                </span>
                {source.chunks > 0 && (
                  <span className="shrink-0 text-text-secondary">
                    {localize('com_ui_tars_tool_summary_chunks', { count: source.chunks })}
                  </span>
                )}
              </summary>
              {source.excerpt && (
                <p className="ml-6 mt-1 whitespace-pre-wrap break-words text-text-secondary">
                  {source.excerpt}
                  {'…'}
                </p>
              )}
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}

function GeneratedLinks({ step }: { step: TTarsToolStep }) {
  const localize = useLocalize();
  if (!step.links?.length) {
    return null;
  }
  return (
    <section className="space-y-2">
      {step.links.map((link) =>
        link.type === 'chart' ? (
          <img
            key={link.url}
            src={link.url}
            alt={localize('com_ui_tars_tool_chart_alt')}
            className="max-h-80 rounded-md border border-border-light"
          />
        ) : (
          <a
            key={link.url}
            href={link.url}
            className="inline-flex items-center gap-1 text-xs text-text-primary underline"
          >
            <FileOutput className="size-3.5" aria-hidden="true" />
            {localize('com_ui_tars_tool_download')}
          </a>
        ),
      )}
    </section>
  );
}

function StepOutput({ step }: { step: TTarsToolStep }) {
  const localize = useLocalize();
  if (!step.output) {
    return null;
  }
  const title = localize(
    step.ok ? 'com_ui_tars_trace_tool_output' : 'com_ui_tars_trace_tool_error',
  );
  return (
    <section>
      <div className={SECTION_TITLE_CLASSES}>
        {title}
        {step.truncated && (
          <span className="font-normal">
            {' · '}
            {localize('com_ui_tars_tool_output_truncated')}
          </span>
        )}
      </div>
      {step.ok && MARKDOWN_TABLE.test(step.output) ? (
        <div className="max-h-72 overflow-auto text-xs">
          <MarkdownLite content={step.output} codeExecution={false} />
        </div>
      ) : (
        <pre className={PRE_CLASSES}>{step.output}</pre>
      )}
    </section>
  );
}

export default function TarsToolCall({
  name,
  args = '',
  toolCallId,
  attachments,
  initialProgress = 0.1,
  isSubmitting,
  runStepStatus,
  runStepDurationMs,
  onExpand,
}: {
  name: string;
  args?: string | Record<string, unknown>;
  toolCallId?: string;
  attachments?: TAttachment[];
  initialProgress?: number;
  isSubmitting: boolean;
  runStepStatus?: PartMetadata['runStepStatus'];
  runStepDurationMs?: PartMetadata['runStepDurationMs'];
  onExpand?: () => void;
}) {
  const localize = useLocalize();
  const [showInfo, setShowInfo] = useState(false);
  const { style: expandStyle, ref: expandRef } = useExpandCollapse(showInfo);
  const { shouldRenderBody, mountBody, handleTransitionEnd } = useLazyCollapseBody(showInfo);

  const copy = getTarsToolCopy(name);
  const Icon = copy.icon;

  const step = useMemo(
    () =>
      attachments?.find(
        (attachment) =>
          attachment.type === Tools.tars_trace &&
          attachment[Tools.tars_trace]?.step != null &&
          (!toolCallId || !attachment.toolCallId || attachment.toolCallId === toolCallId),
      )?.[Tools.tars_trace]?.step,
    [attachments, toolCallId],
  );

  const detail = useMemo(() => getTarsToolDetail(copy, args), [copy, args]);
  const sql = useMemo(() => parseJsonField(args, 'sql'), [args]);
  const summaryText = useSummaryText(step);
  const progress = useMemo(
    () => (step == null ? getTarsToolProgress(attachments, toolCallId) : undefined),
    [attachments, toolCallId, step],
  );

  const isClosed = runStepStatus != null;
  const hasError = runStepStatus === 'failed' || step?.ok === false;
  const displayProgress = useProgress(isClosed || step != null ? 1 : initialProgress);
  const phase = resolveToolCallPhase({
    runStepStatus,
    displayProgress,
    reportedProgress: step != null ? 1 : initialProgress,
    isSubmitting,
    hasError,
  });

  const label = localize(labelKeyFor(copy, phase));
  /** While a long call reports progress, that line says more than its
   *  arguments do; once it settles, the arguments and the outcome take over. */
  const subtitle =
    phase === 'running' && progress
      ? progress
      : [detail, phase === 'completed' ? summaryText : ''].filter(Boolean).join(' · ');
  const hasBody = Boolean(sql || step?.sources?.length || step?.links?.length || step?.output);

  const handleToggle = useCallback(() => {
    mountBody();
    if (!showInfo) {
      onExpand?.();
    }
    setShowInfo((prev) => !prev);
  }, [mountBody, onExpand, showInfo]);

  return (
    <>
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {phase === 'running' ? localize(copy.running) : label}
      </span>
      <div className={TOOL_ROW_CLASSES} data-testid="tars-tool-call" data-tool-call-id={toolCallId}>
        <ProgressText
          phase={phase}
          onClick={handleToggle}
          inProgressText={label}
          finishedText={label}
          subtitle={subtitle || undefined}
          durationMs={runStepDurationMs}
          icon={
            <Icon
              className={cn(
                'size-4 shrink-0 text-text-secondary',
                phase === 'running' && 'animate-pulse',
              )}
              aria-hidden="true"
            />
          }
          hasInput={hasBody}
          isExpanded={showInfo}
        />
      </div>
      <div style={expandStyle} onTransitionEnd={handleTransitionEnd}>
        <div className="overflow-hidden" ref={expandRef}>
          {hasBody && shouldRenderBody && (
            <div
              className={cn(
                toolPanelSpacingClassName,
                'space-y-3 rounded-lg border border-border-light bg-surface-secondary px-3 py-2',
              )}
            >
              {sql && (
                <section>
                  <div className={SECTION_TITLE_CLASSES}>{localize('com_ui_tars_trace_sql')}</div>
                  <pre className={PRE_CLASSES}>{sql}</pre>
                </section>
              )}
              {step && <SourceList step={step} />}
              {step && <GeneratedLinks step={step} />}
              {step && <StepOutput step={step} />}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
