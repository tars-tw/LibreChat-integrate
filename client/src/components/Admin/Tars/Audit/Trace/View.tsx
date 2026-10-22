import { useMemo, useState } from 'react';
import { Chip } from '@librechat/client';
import { User, Sparkles } from 'lucide-react';
import type { TTarsMessageTrace, TTarsTraceRow } from 'librechat-data-provider';
import type { ChartRow } from './layout';
import {
  Dot,
  Row,
  Section,
  TONE_CHIP,
  useSeparators,
  QuestionAnswer,
  StatusErrorAlert,
  TraceErrorBoundary,
} from './Parts';
import MarkdownLite from '~/components/Chat/Messages/Content/MarkdownLite';
import { finishReasonLabel, outcomeTone } from './outcome';
import TraceCapabilities from './Sections/Capabilities';
import TraceReferences from './Sections/References';
import TraceOverview from './Sections/Overview';
import TraceNotices from './Sections/Notices';
import { summarizeTrace } from './summary';
import TraceModel from './Sections/Model';
import TraceFiles from './Sections/Files';
import { statusLabel } from './layout';
import { useLocalize } from '~/hooks';
import TraceDetail from './Detail';
import TraceChart from './Chart';

/**
 * One message's real `message_execution_trace`, as the audit report's dialog
 * shows it — a port of pwc_tars `AgentTrace/TraceTimelinePreview.jsx`. Each
 * block below the question and answer is its own component under `Sections/`,
 * reading the one summary computed here.
 */
export default function TraceView({ data }: { data: TTarsMessageTrace }) {
  const localize = useLocalize();
  const { SEP } = useSeparators();
  const [detailRow, setDetailRow] = useState<TTarsTraceRow | ChartRow | null>(null);
  const summary = useMemo(() => summarizeTrace(data), [data]);
  const { message, user, statusCode, errorMessage, isAborted, isLangflowRoute, queryText } =
    summary;

  /** A run that did not complete is labeled by how it ended, as the status strip labels it. */
  const finishInfo = useMemo(() => {
    if (isAborted) {
      return {
        label: statusLabel(localize, statusCode, isAborted),
        tone: outcomeTone(statusCode, isAborted),
      };
    }
    return finishReasonLabel(localize, summary.finishReason);
  }, [isAborted, localize, statusCode, summary.finishReason]);

  return (
    <TraceErrorBoundary title={localize('com_ui_tars_audit_trace_view_error')}>
      <div className="text-text-primary text-xs">
        <TraceOverview summary={summary} />
        {errorMessage && <StatusErrorAlert message={errorMessage} />}
        <TraceCapabilities summary={summary} />

        <QuestionAnswer
          icon={User}
          label={localize('com_ui_tars_audit_trace_user_question')}
          badge={
            <Chip tone="neutral">
              {localize('com_ui_tars_audit_trace_turn_n', { turn: summary.historyTurns + 1 })}
            </Chip>
          }
          content={queryText}
        >
          {/* User-authored text stays plain: it is untrusted input, never markdown. */}
          <p className="text-xs break-words whitespace-pre-wrap">{queryText || '—'}</p>
        </QuestionAnswer>

        {summary.chart.rows.length > 0 && (
          <TraceErrorBoundary title={localize('com_ui_tars_audit_trace_chart_error')}>
            <TraceChart summary={summary} onSelect={setDetailRow} />
          </TraceErrorBoundary>
        )}

        {/* message.response is the persisted answer; the trace's own text rows need not match it. */}
        <QuestionAnswer
          icon={Sparkles}
          label={localize('com_ui_tars_audit_trace_system_response')}
          badge={
            finishInfo ? (
              <Chip tone={TONE_CHIP[finishInfo.tone]} leading={<Dot tone={finishInfo.tone} />}>
                {finishInfo.label}
              </Chip>
            ) : null
          }
          content={message.response}
        >
          {message.response ? (
            <div className="prose text-text-primary max-w-none !text-xs leading-relaxed [--markdown-font-size:0.75rem] [&_*]:!text-xs [&_li]:!my-0.5 [&_ol]:!my-1.5 [&_p]:!my-1.5 [&_ul]:!my-1.5">
              <MarkdownLite content={message.response} codeExecution={false} />
            </div>
          ) : (
            <p className="text-xs">
              {isLangflowRoute
                ? localize('com_ui_tars_audit_trace_langflow_no_response')
                : localize('com_ui_tars_audit_trace_aborted_no_response')}
            </p>
          )}
        </QuestionAnswer>

        <TraceNotices summary={summary} />
        <Section icon={User} title={localize('com_ui_tars_audit_trace_more_user_info')}>
          <div className="space-y-1">
            <Row label="Email">{user?.email || '—'}</Row>
            <Row label={localize('com_ui_tars_audit_trace_user_groups')}>
              {user?.user_groups?.length
                ? user.user_groups.map((group) => group.name).join(SEP)
                : '—'}
            </Row>
            <Row label={localize('com_ui_tars_audit_trace_ip_address')}>
              {message.ip_addr || '—'}
            </Row>
          </div>
        </Section>
        <TraceReferences summary={summary} />
        <TraceModel summary={summary} />
        <TraceFiles summary={summary} />

        <TraceDetail trace={summary.trace} row={detailRow} onClose={() => setDetailRow(null)} />
      </div>
    </TraceErrorBoundary>
  );
}
