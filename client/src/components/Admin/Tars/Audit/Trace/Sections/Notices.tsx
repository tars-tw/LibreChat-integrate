import { Activity } from 'lucide-react';
import type { TraceSummary } from '../summary';
import { Row, Group, Section, SubLabel, useSeparators } from '../Parts';
import { fmtMs, planStatusLabel } from '../layout';
import { SUGGEST_TIMING_FIELDS } from '../report';
import { finishReasonLabel } from '../outcome';
import { useLocalize } from '~/hooks';

/** Errors, stop reasons and other notes; hidden entirely when empty, as most messages have none. */
export default function TraceNotices({ summary }: { summary: TraceSummary }) {
  const localize = useLocalize();
  const { SEP } = useSeparators();
  const { errorRows, degradationNotes, clarificationRow, planRow, notableStops, suggestedRow } =
    summary;
  const hasNotices =
    errorRows.length > 0 ||
    degradationNotes.length > 0 ||
    clarificationRow != null ||
    planRow != null ||
    notableStops.length > 0 ||
    suggestedRow != null;
  if (!hasNotices) {
    return null;
  }

  return (
    <Section icon={Activity} title={localize('com_ui_tars_audit_trace_execution_notices')}>
      {/* Fatal errors have no bar of their own, so this is their only place. */}
      {errorRows.length > 0 && (
        <Group label={localize('com_ui_tars_audit_trace_errors')}>
          {errorRows.map((row) => (
            <Row key={row.id} label={row.payload?.error_code || '—'}>
              {row.payload?.message || '—'}
            </Row>
          ))}
        </Group>
      )}
      {notableStops.length > 0 && (
        <Group
          label={localize('com_ui_tars_audit_trace_finish_reason')}
          tooltip={localize('com_ui_tars_audit_trace_finish_reason_desc')}
        >
          {notableStops.map((row) => (
            <Row
              key={row.id}
              label={localize('com_ui_tars_audit_trace_turn_n', { turn: row.turn ?? '' })}
            >
              {finishReasonLabel(localize, row.payload?.finish_reason)?.label}
            </Row>
          ))}
        </Group>
      )}
      {/* Joined before the final frame, so these are times the user actually waited. */}
      {suggestedRow != null && (
        <Group label={localize('com_ui_tars_audit_trace_suggested_question')}>
          <Row label={localize('com_ui_tars_audit_trace_generated_count')}>
            {localize('com_ui_tars_audit_trace_records_unit', {
              count: suggestedRow.payload?.count ?? 0,
            })}
          </Row>
          {SUGGEST_TIMING_FIELDS.some(([key]) => suggestedRow.payload?.[key] != null) && (
            <SubLabel>{localize('com_ui_tars_audit_trace_duration')}</SubLabel>
          )}
          {SUGGEST_TIMING_FIELDS.filter(([key]) => suggestedRow.payload?.[key] != null).map(
            ([key, labelKey]) => (
              <Row key={key} label={localize(labelKey)} nested>
                {fmtMs(suggestedRow.payload?.[key], localize)}
              </Row>
            ),
          )}
        </Group>
      )}
      {degradationNotes.length > 0 && (
        <Group
          label={localize('com_ui_tars_audit_trace_degradation_notes')}
          tooltip={localize('com_ui_tars_audit_trace_degradation_notes_desc')}
        >
          {degradationNotes.map((note, index) => (
            <Row key={index} label={index + 1}>
              {note}
            </Row>
          ))}
        </Group>
      )}
      {clarificationRow != null && (
        <Group label={localize('com_ui_tars_audit_trace_clarification')}>
          <Row label={localize('com_ui_tars_audit_trace_clarification_question')}>
            {clarificationRow.payload?.question || '—'}
          </Row>
          {(clarificationRow.payload?.options?.length ?? 0) > 0 && (
            <Row label={localize('com_ui_tars_audit_trace_clarification_options')}>
              {clarificationRow.payload?.options?.map((option) => option.label).join(SEP)}
            </Row>
          )}
        </Group>
      )}
      {(planRow?.payload?.items?.length ?? 0) > 0 && (
        <Group label={localize('com_ui_tars_audit_trace_plan')}>
          {planRow?.payload?.items?.map((item, index) => (
            <Row key={index} label={planStatusLabel(localize, item.status)}>
              {item.content}
            </Row>
          ))}
        </Group>
      )}
    </Section>
  );
}
