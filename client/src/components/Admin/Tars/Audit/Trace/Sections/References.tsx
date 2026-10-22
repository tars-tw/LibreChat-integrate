import { History, BookOpen, CircleStop } from 'lucide-react';
import type { TTarsTraceRow } from 'librechat-data-provider';
import type { TraceSummary } from '../summary';
import { Row, None, Group, Section, DetailField, useSeparators, MemoryDocument } from '../Parts';
import { fmtMs, historyRoleLabel, historyContentText } from '../layout';
import { labeledMemoryDocuments, memoryDocumentId } from '../documents';
import { fixedNumber } from '../values';
import { ragStats } from '../summary';
import { useLocalize } from '~/hooks';

/** What the turn drew on: memory, files, knowledge bases, prior tool context and history. */
export default function TraceReferences({ summary }: { summary: TraceSummary }) {
  const localize = useLocalize();
  const { SEP, DOT } = useSeparators();
  const {
    requestRow,
    memoryRow,
    longTermRow,
    toolContextRow,
    ragRows,
    webSources,
    conversationHistory,
  } = summary;
  const request = requestRow?.payload;
  const memory = memoryRow?.payload;
  const longTermDocs = longTermRow?.payload?.documents ?? [];
  const longTermSites = longTermRow?.payload?.websites ?? [];

  return (
    <>
      <Section icon={BookOpen} title={localize('com_ui_tars_audit_trace_references')}>
        <Group label={localize('com_ui_tars_audit_trace_user_memory')}>
          {/* Without this row, "ran and matched nothing" and "never enabled" look the same. */}
          {memory != null &&
            (memory.retrieval_ms != null || memory.context_available === false) && (
              <Row label={localize('com_ui_tars_audit_trace_memory_recall')}>
                {memory.retrieval_ms != null
                  ? fmtMs(Math.round(memory.retrieval_ms), localize)
                  : '—'}
                {memory.context_available === false
                  ? `${DOT}${localize('com_ui_tars_audit_trace_memory_not_available')}`
                  : ''}
              </Row>
            )}
          {memory?.records?.length ? (
            memory.records.map((record, index) => (
              <DetailField
                key={index}
                label={`${record.memory_type ?? '—'}${DOT}${localize('com_ui_tars_audit_trace_similarity')} ${
                  typeof record.score === 'number' ? record.score.toFixed(4) : record.score
                }${DOT}${localize('com_ui_tars_audit_trace_created_at')} ${(record.created_at || '').slice(0, 10)}`}
                value={String(record.content || '')}
              />
            ))
          ) : (
            <None>{localize('com_ui_tars_audit_trace_not_triggered')}</None>
          )}
        </Group>

        <Group label={localize('com_ui_tars_audit_trace_long_term_memory')}>
          {longTermDocs.length || longTermSites.length ? (
            <>
              {labeledMemoryDocuments(longTermDocs).map(({ labelKey, document }, index) => (
                <Row key={`d-${index}`} label={localize(labelKey)}>
                  <MemoryDocument id={memoryDocumentId(document)} filename={document.filename} />
                </Row>
              ))}
              {longTermSites.map((site, index) => (
                <Row key={`w-${index}`} label={localize('com_ui_tars_audit_trace_webpage')}>
                  {site.name}
                </Row>
              ))}
            </>
          ) : (
            <None>{localize('com_ui_tars_audit_trace_not_uploaded')}</None>
          )}
        </Group>

        <Group label={localize('com_ui_tars_audit_trace_kb_retrieval')}>
          {ragRows.length ? (
            ragRows.map((row) => <RetrievalRow key={row.id} row={row} separator={SEP} />)
          ) : (
            <None>{localize('com_ui_tars_audit_trace_not_enabled')}</None>
          )}
        </Group>

        {/* Earlier turns' tool calls replayed into this prompt — not this turn's own bars. */}
        <Group label={localize('com_ui_tars_audit_trace_prior_tool_context')}>
          {toolContextRow?.payload?.text ? (
            <DetailField
              label={localize('com_ui_tars_audit_trace_records_unit', {
                count: toolContextRow.payload.entry_count || 0,
              })}
              value={toolContextRow.payload.text}
            />
          ) : (
            <None>{localize('com_ui_tars_audit_trace_not_triggered')}</None>
          )}
        </Group>

        {webSources.length > 0 && (
          <Group label={localize('com_ui_tars_audit_trace_web_sources')}>
            {webSources.map((url, index) => (
              <Row key={url} label={index + 1}>
                {url}
              </Row>
            ))}
          </Group>
        )}

        {/* The schema actually spliced into the prompt, not merely the tool being available. */}
        {request?.sql_schema_injected && (
          <Group label={localize('com_ui_tars_audit_trace_sql_schema_injected')}>
            <DetailField
              label={localize('com_ui_tars_audit_trace_schema')}
              value={request.sql_schema_injected}
            />
          </Group>
        )}

        <Group
          label={
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>{localize('com_ui_tars_audit_trace_conversation_history')}</span>
              {conversationHistory.length > 0 && (
                <span className="text-text-secondary text-xs font-normal normal-case">
                  {localize('com_ui_tars_audit_trace_history_turn_summary', {
                    turns: summary.historyTurns,
                    messages: summary.historyMessageCount,
                  })}
                </span>
              )}
            </div>
          }
        >
          {summary.hasContextCompaction && (
            <div className="border-status-warning-border bg-status-warning-subtle/60 text-status-warning mb-2 flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs">
              <History className="size-3.5 shrink-0" aria-hidden />
              <span>{localize('com_ui_tars_audit_trace_history_compacted_note')}</span>
            </div>
          )}
          {summary.hasTurnLimit && (
            <div className="border-status-warning-border bg-status-warning-subtle/60 text-status-warning mb-2 flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs">
              <CircleStop className="size-3.5 shrink-0" aria-hidden />
              <span>{localize('com_ui_tars_audit_trace_history_turn_limit_note')}</span>
            </div>
          )}
          {summary.annotatedHistory.length ? (
            summary.annotatedHistory.map((entry, index) => (
              <DetailField
                key={index}
                label={`${localize('com_ui_tars_audit_trace_turn_n', { turn: entry.turnIndex })}${DOT}${historyRoleLabel(localize, entry.role)}`}
                value={historyContentText(entry.content)}
              />
            ))
          ) : (
            <None>{localize('com_ui_tars_audit_trace_no_history_initial')}</None>
          )}
        </Group>
      </Section>
    </>
  );
}

/** One knowledge-base retrieval: what was considered, what survived, and why in that order. */
function RetrievalRow({ row, separator }: { row: TTarsTraceRow; separator: string }) {
  const localize = useLocalize();
  const stats = ragStats(row);
  return (
    <Row label={row.payload?.query || localize('com_ui_tars_audit_trace_retrieval_fallback')}>
      {localize('com_ui_tars_audit_trace_candidates_kept', {
        candidates: stats.candidates,
        kept: stats.kept,
      })}
      {stats.backend
        ? localize('com_ui_tars_audit_trace_reranker_note', { backend: stats.backend })
        : ''}
      {stats.floor != null
        ? localize('com_ui_tars_audit_trace_score_floor_note', {
            floor: fixedNumber(stats.floor, 4),
          })
        : ''}
      {stats.weights.length > 0 && (
        <>
          <br />
          {localize('com_ui_tars_audit_trace_channel_weights')}
          {stats.weights.map(([name, weight]) => `${name} ${weight}`).join(separator)}
        </>
      )}
      {stats.candidateIds.length > 0 && (
        <>
          <br />
          {localize('com_ui_tars_audit_trace_candidate_milvus_ids')}
          <span className="font-mono text-xs">{stats.candidateIds.join(separator)}</span>
        </>
      )}
      {stats.keptIds.length > 0 && (
        <>
          <br />
          {localize('com_ui_tars_audit_trace_kept_milvus_ids')}
          <span className="font-mono text-xs">{stats.keptIds.join(separator)}</span>
        </>
      )}
    </Row>
  );
}
