import { Fragment } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import type { TraceSummary } from '../summary';
import { Row, Code, None, Group, Section, SubLabel, useSeparators } from '../Parts';
import { fmtJsonInline } from '../layout';
import { useLocalize } from '~/hooks';

/** The retrieval and generation settings the turn ran with. */
export default function TraceModel({ summary }: { summary: TraceSummary }) {
  const localize = useLocalize();
  const { SEP } = useSeparators();
  const provenance = summary.provenanceRow?.payload;

  return (
    <Section icon={SlidersHorizontal} title={localize('com_ui_tars_audit_trace_model_params')}>
      {provenance == null ? (
        <None>{localize('com_ui_tars_audit_trace_no_record')}</None>
      ) : (
        <>
          <Group label={localize('com_ui_tars_audit_trace_embedding')}>
            {/* Grouped by knowledge base: two sharing one model would otherwise look identical. */}
            {provenance.embedding_profiles?.length ? (
              provenance.embedding_profiles.map((profile, index) => (
                <Fragment key={index}>
                  <SubLabel>
                    {profile.kb_name ||
                      profile.kb_id ||
                      localize('com_ui_tars_audit_trace_kb_name_unknown')}
                  </SubLabel>
                  <Row label={localize('com_ui_tars_audit_trace_model_label')} nested>
                    {profile.embedding_model_name}
                  </Row>
                  {profile.embedding_dims != null && (
                    <Row label={localize('com_ui_tars_audit_trace_vector_dims')} nested>
                      {profile.embedding_dims}
                    </Row>
                  )}
                </Fragment>
              ))
            ) : (
              <None>{localize('com_ui_tars_audit_trace_rag_not_enabled')}</None>
            )}
            {provenance.milvus_url && (
              <Row label={localize('com_ui_tars_audit_trace_vector_db')}>
                {provenance.milvus_url}
                {provenance.milvus_port ? `:${provenance.milvus_port}` : ''}
              </Row>
            )}
          </Group>
          {/* rerank_backend is a backend id (local_crossencoder / cohere); rerank_model_name is the model. */}
          {provenance.rerank_backend && (
            <Group label={localize('com_ui_tars_audit_trace_rerank')}>
              <Row label={localize('com_ui_tars_audit_trace_engine')}>
                {provenance.rerank_backend}
              </Row>
              {provenance.rerank_model_name && (
                <Row label={localize('com_ui_tars_audit_trace_model_label')}>
                  {provenance.rerank_model_name}
                </Row>
              )}
              {provenance.retrieval_params?.rerank_floor_ratio != null && (
                <Row label={localize('com_ui_tars_audit_trace_score_floor_ratio')}>
                  {provenance.retrieval_params.rerank_floor_ratio}{' '}
                  {localize('com_ui_tars_audit_trace_score_floor_ratio_hint')}
                </Row>
              )}
            </Group>
          )}
          {provenance.retrieval_params && (
            <Group label={localize('com_ui_tars_audit_trace_retrieval_params')}>
              {provenance.retrieval_params.score_threshold != null && (
                <Row label={localize('com_ui_tars_audit_trace_similarity_threshold')}>
                  {provenance.retrieval_params.score_threshold}
                </Row>
              )}
              {provenance.retrieval_params.default_limit != null && (
                <Row label={localize('com_ui_tars_audit_trace_kb_limit')}>
                  {localize('com_ui_tars_audit_trace_records_unit', {
                    count: provenance.retrieval_params.default_limit,
                  })}
                </Row>
              )}
            </Group>
          )}
          <Group label={localize('com_ui_tars_audit_trace_generation')}>
            <Row label={localize('com_ui_tars_audit_trace_model_label')}>
              {provenance.model_name || '—'}
            </Row>
            <Row label={localize('com_ui_tars_audit_trace_sampling_params')}>
              {provenance.temperature != null ? (
                <Code>{fmtJsonInline({ temperature: provenance.temperature })}</Code>
              ) : (
                '—'
              )}
            </Row>
            {/* What resolve_llm_kwargs actually passed; keys follow each model's config. */}
            {Object.keys(provenance.model_kwargs ?? {}).length > 0 && (
              <Row label={localize('com_ui_tars_audit_trace_model_call_params')}>
                <Code>{fmtJsonInline(provenance.model_kwargs)}</Code>
              </Row>
            )}
            {/* Otherwise "chose not to search" and "never had the tool" look identical. */}
            {(provenance.available_tools?.length ?? 0) > 0 && (
              <Row label={localize('com_ui_tars_audit_trace_available_tools')}>
                {provenance.available_tools?.join(SEP)}
              </Row>
            )}
            {provenance.native_tool_calling != null && (
              <Row label={localize('com_ui_tars_audit_trace_native_tool_calling')}>
                {provenance.native_tool_calling
                  ? localize('com_ui_tars_audit_trace_native_tool_calling_native')
                  : localize('com_ui_tars_audit_trace_native_tool_calling_json')}
              </Row>
            )}
            {provenance.model_endpoint && (
              <Row label={localize('com_ui_tars_audit_trace_model_endpoint')}>
                {provenance.model_endpoint}
              </Row>
            )}
          </Group>
        </>
      )}
    </Section>
  );
}
