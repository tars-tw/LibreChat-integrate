import { Separator } from '@librechat/client';
import {
  Box,
  Info,
  User,
  Zap,
  Clock,
  Timer,
  Gauge,
  Sheet,
  Image,
  Brain,
  Wrench,
  History,
  Activity,
  Workflow,
  Lightbulb,
  Paperclip,
  TriangleAlert,
} from 'lucide-react';
import type { TraceSummary } from '../summary';
import { Dot, Note, MetaItem, MetaStrip, TONE_TEXT, TraceBanner, useSeparators } from '../Parts';
import { fmtMs, statusLabel, reasoningEffortLabel } from '../layout';
import { overviewAttachments } from '../documents';
import AttachmentList from '../Attachments';
import { outcomeTone } from '../outcome';
import { fmtTimestamp } from '../time';
import { useLocalize } from '~/hooks';
import BreakdownMeter from '../Meter';
import { cn } from '~/utils';

/** The run at a glance: banners for unusual runs, then who, which model, how it ended and what it cost. */
export default function TraceOverview({ summary }: { summary: TraceSummary }) {
  const localize = useLocalize();
  const { SEP, DOT } = useSeparators();
  const {
    message,
    user,
    requestRow,
    provenanceRow,
    rawPayload,
    rawTruncated,
    rawOriginalChars,
    isLangflowRoute,
    notAppliedRow,
    unappliedRegenerateCount,
    statusCode,
    isAborted,
  } = summary;
  const request = requestRow?.payload;
  const provenance = provenanceRow?.payload;
  const reasoningEffort = rawPayload.reasoning_effort?.toLowerCase().trim();
  const reasoningOn = !!reasoningEffort && reasoningEffort !== 'off' && reasoningEffort !== 'none';
  const statusTone = outcomeTone(statusCode, isAborted);
  const messageCreatedAt =
    message.created_at || requestRow?.started_at || summary.trace?.[0]?.started_at;
  /** Every file the turn could read, once each; an older trace without the list keeps the three fields below. */
  const attachments = overviewAttachments(summary.longTermRow?.payload?.documents ?? [], {
    files: rawPayload.upload_files,
    filename: rawPayload.upload_filename,
  });

  return (
    <>
      {isLangflowRoute && (
        <TraceBanner icon={Workflow}>
          {localize('com_ui_tars_audit_trace_langflow_banner')}
        </TraceBanner>
      )}
      {notAppliedRow != null && (
        <TraceBanner icon={History}>
          {localize('com_ui_tars_audit_trace_regenerate_not_applied_banner')}
        </TraceBanner>
      )}
      {notAppliedRow == null && unappliedRegenerateCount > 0 && (
        <TraceBanner icon={Info}>
          {localize('com_ui_tars_audit_trace_unapplied_regenerate_count', {
            count: unappliedRegenerateCount,
          })}
        </TraceBanner>
      )}
      {rawTruncated && (
        <TraceBanner icon={TriangleAlert}>
          {localize('com_ui_tars_audit_trace_request_raw_truncated_banner', {
            chars: rawOriginalChars?.toLocaleString() ?? '—',
          })}
        </TraceBanner>
      )}

      <div className="border-border-light bg-surface-secondary/40 mb-3.5 rounded-xl border p-3 sm:p-3.5">
        <MetaStrip>
          <MetaItem icon={User} label={localize('com_ui_tars_audit_trace_user')}>
            {user?.username || localize('com_ui_tars_audit_trace_user_deleted')}
          </MetaItem>
          {/* No domain name means the general brain — a real state, not missing data. */}
          <MetaItem icon={Brain} label={localize('com_ui_tars_audit_trace_assistant')}>
            {request?.domain_name || localize('com_ui_tars_audit_trace_general_domain')}
          </MetaItem>
          <MetaItem icon={Box} label={localize('com_ui_tars_audit_trace_model_label')}>
            {message.model_name || '—'}
          </MetaItem>
          {/* "off" is a valid non-empty value, so truthiness alone would report it as enabled. */}
          <MetaItem
            icon={Lightbulb}
            label={localize('com_ui_tars_audit_trace_reasoning_effort')}
            tooltip={localize('com_ui_tars_audit_trace_reasoning_effort_desc')}
          >
            {rawTruncated ? (
              <Note>—</Note>
            ) : (
              <>
                <Dot tone={reasoningOn ? 'on' : 'off'} />
                <span className={reasoningOn ? 'text-status-success' : 'text-text-tertiary'}>
                  {reasoningEffortLabel(localize, rawPayload.reasoning_effort)}
                </span>
              </>
            )}
          </MetaItem>
        </MetaStrip>

        {!isLangflowRoute && (
          <>
            <Separator className="my-2.5" />
            <MetaStrip>
              <MetaItem icon={Activity} label={localize('com_ui_tars_audit_trace_status')}>
                <Dot tone={statusTone} />
                <span className={cn('font-medium whitespace-nowrap', TONE_TEXT[statusTone])}>
                  {statusLabel(localize, statusCode, isAborted)}
                </span>
              </MetaItem>
              <MetaItem icon={Clock} label={localize('com_ui_tars_audit_trace_sent_at')}>
                {fmtTimestamp(messageCreatedAt)}
              </MetaItem>
              <MetaItem
                icon={Zap}
                label={localize('com_ui_tars_audit_trace_token_usage')}
                tooltip={localize('com_ui_tars_audit_trace_token_usage_desc')}
              >
                <span>{(summary.totalIn + summary.totalOut).toLocaleString()}</span>
                <Note>
                  {DOT}
                  {localize('com_ui_tars_audit_trace_input')} {summary.totalIn.toLocaleString()}
                  {DOT}
                  {localize('com_ui_tars_audit_trace_output')} {summary.totalOut.toLocaleString()}
                </Note>
              </MetaItem>
              <MetaItem
                icon={Wrench}
                label={localize('com_ui_tars_audit_trace_tool_calls')}
                tooltip={localize('com_ui_tars_audit_trace_tool_calls_desc')}
              >
                {summary.toolCallTotal}
                {summary.toolCallTone != null && <Dot tone={summary.toolCallTone} />}
                <Note>
                  {summary.toolSuccessCount} {localize('com_ui_tars_audit_trace_success')}
                  {DOT}
                  {summary.toolFailDisplayCount} {localize('com_ui_tars_audit_trace_fail')}
                </Note>
              </MetaItem>
            </MetaStrip>

            {((message.response_latency ?? 0) > 0 ||
              summary.promptTps != null ||
              summary.tps != null ||
              summary.modelPercent != null) && (
              <>
                <Separator className="my-2.5" />
                <MetaStrip>
                  {((message.response_latency ?? 0) > 0 || summary.modelPercent != null) && (
                    <MetaItem
                      icon={Timer}
                      label={localize('com_ui_tars_audit_trace_response_latency')}
                      tooltip={localize('com_ui_tars_audit_trace_response_latency_desc')}
                    >
                      <span>
                        {fmtMs(
                          Math.round(
                            (message.response_latency ?? 0) > 0
                              ? (message.response_latency ?? 0) * 1000
                              : summary.modelDurationMs + summary.toolWaitDurationMs,
                          ),
                          localize,
                        )}
                      </span>
                      <BreakdownMeter summary={summary} />
                    </MetaItem>
                  )}
                  {summary.promptTps != null && (
                    <MetaItem
                      icon={Zap}
                      label={localize('com_ui_tars_audit_trace_prompt_tps')}
                      tooltip={localize('com_ui_tars_audit_trace_prompt_tps_desc')}
                    >
                      {localize('com_ui_tars_audit_trace_tokens_per_second', {
                        tps: summary.promptTps.toFixed(2),
                      })}
                    </MetaItem>
                  )}
                  {summary.tps != null && (
                    <MetaItem
                      icon={Gauge}
                      label={localize('com_ui_tars_audit_trace_tps')}
                      tooltip={localize('com_ui_tars_audit_trace_tps_desc')}
                    >
                      {localize('com_ui_tars_audit_trace_tokens_per_second', {
                        tps: summary.tps.toFixed(2),
                      })}
                    </MetaItem>
                  )}
                </MetaStrip>
              </>
            )}
          </>
        )}

        {attachments.length > 0 && (
          <>
            <Separator className="my-2.5" />
            <MetaStrip>
              <MetaItem
                icon={Paperclip}
                label={localize('com_ui_tars_audit_trace_attachments')}
                tooltip={localize('com_ui_tars_audit_trace_attachments_desc')}
              >
                <AttachmentList files={attachments} />
              </MetaItem>
            </MetaStrip>
          </>
        )}
        {attachments.length === 0 &&
          (rawPayload.upload_filename ||
            (provenance?.data_files?.length ?? 0) > 0 ||
            (provenance?.image_input_count ?? 0) > 0) && (
            <>
              <Separator className="my-2.5" />
              <MetaStrip>
                {rawPayload.upload_filename && (
                  <MetaItem
                    icon={Paperclip}
                    label={localize('com_ui_tars_audit_trace_upload_file')}
                  >
                    {rawPayload.upload_filename}
                  </MetaItem>
                )}
                {(provenance?.data_files?.length ?? 0) > 0 && (
                  <MetaItem icon={Sheet} label={localize('com_ui_tars_audit_trace_data_files')}>
                    {provenance?.data_files?.join(SEP)}
                  </MetaItem>
                )}
                {(provenance?.image_input_count ?? 0) > 0 && (
                  <MetaItem icon={Image} label={localize('com_ui_tars_audit_trace_image_inputs')}>
                    {localize('com_ui_tars_audit_trace_records_unit', {
                      count: provenance?.image_input_count ?? 0,
                    })}
                  </MetaItem>
                )}
              </MetaStrip>
            </>
          )}
      </div>
    </>
  );
}
