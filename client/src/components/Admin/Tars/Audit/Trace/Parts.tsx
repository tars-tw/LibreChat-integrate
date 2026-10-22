import { Component, useCallback, useEffect, useRef, useState } from 'react';
import { dataService } from 'librechat-data-provider';
import { Download, CircleHelp, ChevronDown, CircleAlert } from 'lucide-react';
import {
  Alert,
  Button,
  Collapsible,
  IconButton,
  TooltipAnchor,
  OGDialogHeader,
  InfoHoverCard,
  useToastContext,
  CollapsibleContent,
  CollapsibleTrigger,
  disclosureChevronVariants,
} from '@librechat/client';
import type { TTarsJsonField } from 'librechat-data-provider';
import type { ChipProps } from '@librechat/client';
import type { ReactNode, RefObject } from 'react';
import type { TraceErrorInfo } from './errors';
import type { Tone } from './layout';
import CopyButton from '~/components/Messages/Content/CopyButton';
import { readTraceError, traceErrorDetails } from './errors';
import { downloadBlob } from '../../Users/helpers';
import { useCopyFeedback } from './copy';
import { useLocalize } from '~/hooks';
import { fmtValue } from './layout';
import { cn } from '~/utils';

/**
 * A trace value can be up to AGENT_TRACE_OUTPUT_MAX_CHARS (1,000,000); putting
 * that in a <pre> at once is a reproducible browser stall. Nothing is dropped —
 * a field grows by another chunk as its box is scrolled.
 */
const RENDER_CHUNK_CHARS = 20000;
/** Progressive loading starts well before the reader can see it stall. */
const NEAR_BOTTOM_PX = 300;

/** Heading of a group, a content block or a question/answer box, as the native trace inspector draws it. */
export const BLOCK_HEADING = 'text-xs font-semibold uppercase tracking-wide text-text-secondary';

/** Bordered box around long text: the native trace inspector's `<pre>` surface. */
export const CONTENT_BOX = 'rounded-xl border border-border-light bg-surface-secondary p-3';

/** List and inline separators: punctuation is locale-specific, so it comes from i18n like every label. */
export function useSeparators(): { SEP: string; DOT: string } {
  const localize = useLocalize();
  return {
    SEP: localize('com_ui_tars_audit_trace_list_separator'),
    DOT: localize('com_ui_tars_audit_trace_inline_separator'),
  };
}

export function TraceBanner({
  icon: Icon,
  tone = 'muted',
  children,
}: {
  icon?: React.ElementType;
  tone?: 'muted' | 'serious';
  children: ReactNode;
}) {
  return (
    <Alert
      variant={tone === 'serious' ? 'warning' : 'neutral'}
      role={tone === 'serious' ? 'alert' : 'status'}
      icon={Icon != null ? <Icon className="size-4" /> : false}
      className="mb-3"
    >
      {children}
    </Alert>
  );
}

/**
 * The status lights of pwc_tars's audit card — green on/good, amber partial,
 * red bad — on LibreChat's status roles. Not the PwC `pwc-success` token: that
 * one is amber, which would make "all good" and "partly failed" look alike.
 */
const DOT_TONES = {
  on: 'bg-status-success',
  good: 'bg-status-success',
  off: 'bg-border-medium',
  neutral: 'bg-text-tertiary',
  warn: 'bg-status-warning',
  bad: 'bg-status-error',
} as const;

/** An outcome's text color, the foreground of the matching {@link TONE_CHIP}. */
export const TONE_TEXT: Record<Tone, string> = {
  good: 'text-status-success',
  warn: 'text-status-warning',
  bad: 'text-status-error',
  neutral: 'text-text-secondary',
};

/**
 * The shared `Chip` tone for an outcome. Only a failure is the error tone;
 * warning is kept for a run stopped short and for notes such as a retry, a cut
 * output or a length stop.
 */
export const TONE_CHIP: Record<Tone, NonNullable<ChipProps['tone']>> = {
  good: 'success',
  warn: 'warning',
  bad: 'error',
  neutral: 'neutral',
};

/** Small round state marker; `tone` picks the semantic color. */
export function Dot({ tone }: { tone: keyof typeof DOT_TONES }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block size-2 shrink-0 rounded-full', DOT_TONES[tone])}
    />
  );
}

/** A compact badge representing an active or inactive capability, mirroring LibreChat tool chips. */
export function CapabilityChip({
  icon: Icon,
  label,
  active,
  note,
}: {
  icon?: React.ElementType;
  label: string;
  active: boolean | null;
  note?: ReactNode;
}) {
  const on = active === true;
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs transition-colors',
        on
          ? 'border-border-light bg-surface-tertiary text-text-primary font-medium'
          : 'border-border-light/40 bg-surface-primary/30 text-text-tertiary opacity-60',
      )}
    >
      {Icon != null && (
        <Icon
          className={cn('size-3.5 shrink-0', on ? 'text-text-secondary' : 'text-text-tertiary')}
          aria-hidden="true"
        />
      )}
      <span>{label}</span>
      <Dot tone={on ? 'on' : 'off'} />
      {note != null && on && <span className="text-text-tertiary/70 font-normal">{note}</span>}
    </div>
  );
}

/** A secondary note after a value, e.g. the bound names after a switch. */
export function Note({ children }: { children: ReactNode }) {
  return <span className="text-text-tertiary/70">{children}</span>;
}

/** The `<dl>` that holds a strip of MetaItems, laid out like the native trace summary bar. */
export function MetaStrip({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <dl className={cn('flex flex-wrap items-center gap-x-5 gap-y-2 text-xs', className)}>
      {children}
    </dl>
  );
}

/**
 * The help glyph after a label. It is sized to the label (the stock one is a 20px
 * form-field icon) and stays faint until hovered so it does not outweigh the label.
 */
export function HelpHint({ text }: { text: string }) {
  return (
    <InfoHoverCard text={text}>
      <CircleHelp
        strokeWidth={1.75}
        className="text-text-tertiary/50 hover:text-text-secondary size-3.5 transition-colors"
        aria-hidden="true"
      />
    </InfoHoverCard>
  );
}

/** One `icon label value` pair inside a MetaStrip. */
export function MetaItem({
  icon: Icon,
  label,
  children,
  tooltip,
}: {
  icon?: React.ElementType;
  label: string;
  children: ReactNode;
  tooltip?: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {/* Weight is left at normal: CJK fonts ship no medium, so a heavier label
          renders bold for Latin ("MCP") but not for Chinese next to it. */}
      <dt className="text-text-secondary inline-flex shrink-0 items-center gap-1.5 text-xs whitespace-nowrap">
        {Icon != null && <Icon className="text-text-tertiary size-3.5 shrink-0" aria-hidden />}
        {label}
        {tooltip && <HelpHint text={tooltip} />}
      </dt>
      <dd className="text-text-primary inline-flex items-center gap-1.5 text-xs tabular-nums">
        {children}
      </dd>
    </div>
  );
}

export interface TraceErrorBoundaryProps {
  children: ReactNode;
  /** Localized heading of the fallback alert; a class component cannot call useLocalize itself. */
  title: string;
  /** Localized guidance under the heading: what still works and who to tell. */
  hint?: string;
  fallback?: ReactNode | ((error: Error) => ReactNode);
  resetKey?: unknown;
}

export interface TraceErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Localized ErrorBoundary protecting sensitive trace subsections (e.g. tool outputs,
 * markdown parsing, chart layouts) from bringing down the entire dialog modal on rendering error.
 */
export class TraceErrorBoundary extends Component<
  TraceErrorBoundaryProps,
  TraceErrorBoundaryState
> {
  state: TraceErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): TraceErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[TraceErrorBoundary]', error, errorInfo);
  }

  componentDidUpdate(prevProps: TraceErrorBoundaryProps) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null });
    }
  }

  render() {
    if (this.state.hasError) {
      if (typeof this.props.fallback === 'function') {
        return this.props.fallback(this.state.error ?? new Error('Unknown error'));
      }
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <Alert variant="warning" role="alert" className="my-2">
          <div className="text-xs">
            <p className="font-medium">{this.props.title}</p>
            {this.props.hint && <p className="text-text-secondary mt-1">{this.props.hint}</p>}
            {this.state.error?.message && <ErrorDetails details={this.state.error.message} />}
          </div>
        </Alert>
      );
    }
    return this.props.children;
  }
}

/** The technical line an administrator needs, selectable and one copy away. */
export function ErrorDetails({ details }: { details: string }) {
  const localize = useLocalize();
  const { isCopied, copyText } = useCopyFeedback();
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-text-secondary text-xs font-medium">
          {localize('com_ui_tars_audit_trace_err_details')}
        </span>
        <CopyButton
          iconOnly
          isCopied={isCopied}
          onClick={() => copyText(details)}
          label={localize('com_ui_tars_audit_trace_err_copy_details')}
        />
      </div>
      <p className="border-border-light bg-surface-primary/80 text-text-primary mt-1 rounded-lg border p-2 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap select-all">
        {details}
      </p>
    </div>
  );
}

/**
 * A failed trace or file request: what went wrong, what to do about it, and
 * the details to hand an administrator. A setting or permission problem is red
 * and offers no retry, since trying again cannot fix it.
 */
export function TraceErrorAlert({
  info,
  context,
  onRetry,
}: {
  info: TraceErrorInfo;
  /** What was being read, such as the message id, for the copied details. */
  context?: string;
  onRetry?: () => void;
}) {
  const localize = useLocalize();
  return (
    <Alert variant={info.needsAdmin ? 'error' : 'warning'} role="alert">
      <div className="text-xs">
        <div className="flex flex-col items-start gap-1">
          <p className="text-sm font-medium">{localize(info.titleKey)}</p>
          <p className="text-text-secondary">{localize(info.hintKey)}</p>
        </div>
        <ErrorDetails details={traceErrorDetails(info, context)} />
        {info.retryable && onRetry && (
          <Button type="button" size="sm" variant="outline" className="mt-2" onClick={onRetry}>
            {localize('com_ui_retry')}
          </Button>
        )}
      </div>
    </Alert>
  );
}

/** A collapsible section; most are closed by default since most messages need none. */
export function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon?: React.ElementType;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mb-3">
      <h3>
        {/* The trigger renders this plain button, which owns the row's look; Radix adds only behavior. */}
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="group/disclosure text-text-secondary hover:bg-surface-hover hover:text-text-primary focus-visible:ring-ring-primary flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            {Icon != null && (
              <span className="bg-surface-tertiary text-text-primary flex size-5 shrink-0 items-center justify-center rounded-md">
                <Icon className="size-3.5" aria-hidden="true" />
              </span>
            )}
            <span className="flex-1">{title}</span>
            <ChevronDown
              className={cn(
                'text-text-tertiary group-hover/disclosure:text-text-primary size-3.5 transition-transform',
                disclosureChevronVariants({ expanded: open }),
              )}
              aria-hidden
            />
          </button>
        </CollapsibleTrigger>
      </h3>
      <CollapsibleContent>
        <div className="border-border-light bg-surface-secondary/40 mt-1.5 space-y-3 rounded-xl border p-3">
          <TraceErrorBoundary title={title}>{children}</TraceErrorBoundary>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** A prominent question or answer card with an icon badge and quick copy action. */
export function QuestionAnswer({
  label,
  icon: Icon,
  content,
  children,
  badge,
}: {
  label: string;
  icon?: React.ElementType;
  content: string | null | undefined;
  children: ReactNode;
  badge?: ReactNode;
}) {
  const localize = useLocalize();
  const { isCopied, copyText } = useCopyFeedback();

  return (
    <div className={cn('mb-3 flex flex-col gap-2', CONTENT_BOX)}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-text-secondary flex items-center gap-2 text-xs font-medium">
          {Icon != null && (
            <span className="bg-surface-tertiary text-text-primary flex size-5 shrink-0 items-center justify-center rounded-md">
              <Icon className="size-3.5" aria-hidden="true" />
            </span>
          )}
          <span>{label}</span>
          {badge}
        </div>
        {content ? (
          <CopyButton
            iconOnly
            isCopied={isCopied}
            onClick={() => copyText(content)}
            label={localize('com_ui_tars_audit_trace_copy_full_content')}
          />
        ) : null}
      </div>
      <ScrollBox content={content} className="max-h-72 text-xs leading-relaxed">
        <TraceErrorBoundary title={label}>{children}</TraceErrorBoundary>
      </ScrollBox>
    </div>
  );
}

export function Group({
  label,
  children,
  tooltip,
}: {
  label: ReactNode;
  children: ReactNode;
  tooltip?: string;
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <h4 className={cn(BLOCK_HEADING, tooltip && 'inline-flex items-center gap-1.5')}>
        {label}
        {tooltip && <HelpHint text={tooltip} />}
      </h4>
      <div className="space-y-1 pl-3">{children}</div>
    </section>
  );
}

export function SubLabel({ children }: { children: ReactNode }) {
  return <div className="text-text-secondary pt-1 text-xs font-medium">{children}</div>;
}

/**
 * One `key  value` pair inside a group. The key column is fixed rather than
 * `auto` because every Row is its own list, and the values must still line up.
 */
export function Row({
  label,
  children,
  nested = false,
}: {
  label: ReactNode;
  children: ReactNode;
  nested?: boolean;
}) {
  return (
    <dl className="grid grid-cols-[9rem_minmax(0,1fr)] gap-x-4 text-xs">
      {/* The indent goes inside the fixed-width label, so nested values stay aligned. */}
      <dt className={cn('text-text-secondary break-words', nested && 'pl-3')}>{label}</dt>
      <dd className="text-text-primary min-w-0 break-words whitespace-pre-wrap">{children}</dd>
    </dl>
  );
}

export function None({ children }: { children: ReactNode }) {
  return <div className="text-text-tertiary text-xs">{children}</div>;
}

/** Inline or block JSON, e.g. sampling and model call parameters. */
export function Code({ children }: { children: ReactNode }) {
  return (
    <div className="border-border-light bg-surface-secondary text-text-primary rounded-lg border px-2 py-1.5 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
      {children}
    </div>
  );
}

/**
 * A dialog body that runs edge to edge: it cancels the dialog surface's own
 * padding so the header's rule and the scroll area reach both sides, while the
 * surface keeps its theme radius, fill and shadow.
 */
export function DialogFrame({ children }: { children: ReactNode }) {
  return <div className="-mx-theme-dialog-x -my-6 flex min-h-0 flex-1 flex-col">{children}</div>;
}

/** A dialog's header row with a rule under it; the right padding clears the dialog's close button. */
export function DialogBar({ children }: { children: ReactNode }) {
  return (
    <div className="border-border-light shrink-0 border-b py-3 pr-14 pl-5 sm:pl-6">
      <OGDialogHeader>{children}</OGDialogHeader>
    </div>
  );
}

/** The shared `IconButton` with its label as a tooltip, for actions other than copy. */
export function IconAction({
  label,
  onClick,
  children,
  inline = false,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  /** Inside a line of text: the 28px target keeps its size but stops growing the line. */
  inline?: boolean;
}) {
  return (
    <TooltipAnchor
      description={label}
      render={
        <IconButton
          label={label}
          size="xs"
          shape="square"
          onClick={onClick}
          className={cn('group/icon-action size-7', inline && '-my-1.5')}
        >
          {/* `IconButton` owns its color, so the muted-until-hovered tint rides on the icon. */}
          <span className="text-text-secondary group-hover/icon-action:text-text-primary inline-flex">
            {children}
          </span>
        </IconButton>
      }
    />
  );
}

/**
 * Calls `onNearBottom` once `ref` is scrolled close to its end. Growth inside a
 * max-height box changes only scrollHeight, so the children are watched too.
 */
function useNearBottom(
  ref: RefObject<HTMLElement>,
  content: unknown,
  onNearBottom?: () => void,
): void {
  useEffect(() => {
    const element = ref.current;
    if (!element || !onNearBottom) {
      return undefined;
    }
    const check = () => {
      const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
      if (remaining < NEAR_BOTTOM_PX) {
        onNearBottom();
      }
    };
    check();
    element.addEventListener('scroll', check);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(check);
    observer?.observe(element);
    Array.from(element.children).forEach((child) => observer?.observe(child));
    return () => {
      element.removeEventListener('scroll', check);
      observer?.disconnect();
    };
  }, [ref, content, onNearBottom]);
}

/** A vertically scrollable box; `onNearBottom` lets a long field load its next chunk. */
export function ScrollBox({
  className,
  content,
  onNearBottom,
  children,
}: {
  className?: string;
  /** Re-measure whenever this changes. */
  content?: unknown;
  onNearBottom?: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useNearBottom(ref, content, onNearBottom);
  return (
    <div ref={ref} className={cn('overflow-y-auto', className)}>
      {children}
    </div>
  );
}

/**
 * One large value, rendered in growing chunks so it stays reachable in full
 * without ever being wholly in the DOM. Copy always takes the whole value.
 */
export function DetailField({
  label,
  value,
  isError = false,
}: {
  label: string;
  value: TTarsJsonField | undefined;
  isError?: boolean;
}) {
  const localize = useLocalize();
  const { isCopied, copyText } = useCopyFeedback();
  const text = fmtValue(value);
  const [visibleChars, setVisibleChars] = useState(() => Math.min(RENDER_CHUNK_CHARS, text.length));
  const shown = text.slice(0, visibleChars);
  const growByOneChunk = useCallback(
    () => setVisibleChars((previous) => Math.min(previous + RENDER_CHUNK_CHARS, text.length)),
    [text.length],
  );

  return (
    <section className="mb-3.5 flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <h4
          className={cn(
            BLOCK_HEADING,
            'flex items-center gap-1.5 break-words',
            isError && 'text-status-error',
          )}
        >
          {isError && <CircleAlert className="size-3.5" aria-hidden />}
          <span>{label}</span>
        </h4>
        <span className="text-text-secondary ml-auto inline-flex shrink-0 items-center gap-1 text-xs tabular-nums">
          {localize('com_ui_tars_audit_trace_char_count', { chars: text.length.toLocaleString() })}
          <CopyButton
            iconOnly
            isCopied={isCopied}
            onClick={() => copyText(text)}
            label={localize('com_ui_tars_audit_trace_copy_full_content')}
          />
        </span>
      </div>
      <ScrollBox
        content={shown}
        onNearBottom={visibleChars < text.length ? growByOneChunk : undefined}
        className={cn(
          'max-h-80',
          CONTENT_BOX,
          isError && 'border-status-error-border bg-status-error-subtle',
        )}
      >
        <pre className="text-text-primary m-0 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
          {shown}
        </pre>
      </ScrollBox>
    </section>
  );
}

/** A long-term-memory file name, downloadable when it has an id: a LibreChat `file_id` or a pwc_tars document. */
export function MemoryDocument({
  id,
  filename,
  inline = false,
}: {
  id?: string | null;
  filename?: string | null;
  /** Shown in a metrics row, where the download button must not grow the line. */
  inline?: boolean;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  if (!id) {
    return <span>{filename}</span>;
  }
  /** The toast names the file and the reason; the full details go to the console for support. */
  const download = async () => {
    try {
      downloadBlob(await dataService.downloadTarsAuditMemoryDocument(id), filename || id);
    } catch (error) {
      const info = await readTraceError(error);
      console.error('[TraceDocument] Download failed', traceErrorDetails(info, id));
      showToast({
        message: localize('com_ui_tars_audit_trace_download_failed_reason', {
          filename: filename || id,
          reason: localize(info.titleKey),
          hint: localize(info.hintKey),
        }),
        status: 'error',
      });
    }
  };
  return (
    <span className="inline-flex items-center gap-1">
      <span>{filename}</span>
      <IconAction label={localize('com_ui_download')} onClick={download} inline={inline}>
        <Download className="size-3.5" aria-hidden />
      </IconAction>
    </span>
  );
}

/** Why the message failed or stopped, with its full diagnostic one copy away. */
export function StatusErrorAlert({ message }: { message: string }) {
  const localize = useLocalize();
  const { isCopied, copyText } = useCopyFeedback();

  return (
    <Alert variant="error" className="mb-3">
      <div className="text-xs">
        <div className="flex items-center justify-between gap-2">
          <p className="font-medium">{localize('com_ui_tars_audit_trace_status_reason')}</p>
          <CopyButton
            iconOnly
            isCopied={isCopied}
            onClick={() => copyText(message)}
            label={localize('com_ui_tars_audit_trace_copy_full_content')}
          />
        </div>
        <div className="border-border-light bg-surface-primary/80 text-text-primary mt-1.5 max-h-28 overflow-y-auto rounded-lg border p-2 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap select-all">
          {message}
        </div>
      </div>
    </Alert>
  );
}
