import { FileOutput } from 'lucide-react';
import type { TraceSummary } from '../summary';
import { Row, None, Group, Section } from '../Parts';
import { useLocalize } from '~/hooks';

/** The file-generation settings the request carried. */
export default function TraceFiles({ summary }: { summary: TraceSummary }) {
  const localize = useLocalize();
  const { rawPayload, rawTruncated, styleEntries } = summary;

  return (
    <Section icon={FileOutput} title={localize('com_ui_tars_audit_trace_file_generate_settings')}>
      {rawTruncated && <None>—</None>}
      {!rawTruncated && !rawPayload.is_file_generate_active && (
        <None>{localize('com_ui_tars_audit_trace_file_generate_not_active')}</None>
      )}
      {!rawTruncated && rawPayload.is_file_generate_active === true && (
        <div className="space-y-1">
          {rawPayload.file_generate_extra_prompt && (
            <Row label={localize('com_ui_tars_audit_trace_file_generate_extra_prompt')}>
              {rawPayload.file_generate_extra_prompt}
            </Row>
          )}
          {rawPayload.file_generate_footer_text && (
            <Row label={localize('com_ui_tars_audit_trace_file_generate_footer_text')}>
              {rawPayload.file_generate_footer_text}
            </Row>
          )}
          {/* style_spec is free-form, so every key is listed rather than a hand-picked set. */}
          {styleEntries.length > 0 && (
            <Group label={localize('com_ui_tars_audit_trace_file_generate_style')}>
              {styleEntries.map(([key, value]) => (
                <Row key={key} label={key}>
                  {value}
                </Row>
              ))}
            </Group>
          )}
          {!rawPayload.file_generate_extra_prompt &&
            !rawPayload.file_generate_footer_text &&
            styleEntries.length === 0 && (
              <None>{localize('com_ui_tars_audit_trace_no_record')}</None>
            )}
        </div>
      )}
    </Section>
  );
}
