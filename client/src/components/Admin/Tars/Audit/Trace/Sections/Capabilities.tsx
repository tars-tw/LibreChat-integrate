import { MCPIcon } from '@librechat/client';
import {
  Globe,
  BookOpen,
  Database,
  Workflow,
  RefreshCw,
  FileOutput,
  MessageCircleQuestion,
} from 'lucide-react';
import type { TraceSummary } from '../summary';
import { CapabilityChip, useSeparators } from '../Parts';
import { requestFlag } from '../layout';
import { useLocalize } from '~/hooks';

/** Which switches the turn ran with, each with what it reached. */
export default function TraceCapabilities({ summary }: { summary: TraceSummary }) {
  const localize = useLocalize();
  const { SEP } = useSeparators();
  const { requestRow, provenanceRow, rawPayload, rawTruncated, isLangflowRoute } = summary;
  const flag = (value: unknown) => requestFlag(rawTruncated, value);
  const request = requestRow?.payload;
  const provenance = provenanceRow?.payload;
  const kbNames = request?.knowledge_base_names ?? [];

  return (
    <div className="mb-3.5 flex flex-wrap items-center gap-1.5">
      <CapabilityChip
        icon={Database}
        label={localize('com_ui_tars_audit_trace_database')}
        active={flag(rawPayload.is_database_bound)}
        note={request?.database_names?.length ? request.database_names.join(SEP) : undefined}
      />
      <CapabilityChip
        icon={Globe}
        label={localize('com_ui_tars_audit_trace_web_search')}
        active={flag(rawPayload.is_enable_web_search)}
      />
      <CapabilityChip
        icon={BookOpen}
        label={localize('com_ui_tars_audit_trace_kb_retrieval')}
        active={kbNames.length > 0}
        note={kbNames.length > 0 ? kbNames.join(SEP) : undefined}
      />
      <CapabilityChip
        icon={FileOutput}
        label={localize('com_ui_tars_audit_trace_file_generate')}
        active={flag(rawPayload.is_file_generate_active)}
        note={
          rawPayload.is_file_generate_active && rawPayload.file_generate_type
            ? String(rawPayload.file_generate_type).toUpperCase()
            : undefined
        }
      />
      <CapabilityChip
        icon={MessageCircleQuestion}
        label={localize('com_ui_tars_audit_trace_suggested_question')}
        active={flag(rawPayload.is_enable_suggested_questions !== false)}
      />
      <CapabilityChip
        icon={MCPIcon}
        label="MCP"
        active={flag(rawPayload.is_mcp_enabled)}
        note={
          provenance?.mcp_servers?.length
            ? provenance.mcp_servers.map((server) => server.name).join(SEP)
            : undefined
        }
      />
      <CapabilityChip
        icon={Workflow}
        label="Langflow"
        active={isLangflowRoute || flag(rawPayload.is_enable_langflow)}
        note={request?.langflow_names?.length ? request.langflow_names.join(SEP) : undefined}
      />
      {rawPayload.is_regenerate === true && (
        <CapabilityChip
          icon={RefreshCw}
          label={localize('com_ui_tars_audit_trace_regenerate')}
          active={true}
        />
      )}
      {request?.system_version && (
        <span className="text-text-tertiary ml-auto text-xs tabular-nums">
          {request.system_version}
        </span>
      )}
    </div>
  );
}
