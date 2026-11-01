import type {
  TTarsDatasetLevelInput,
  TTarsDatasetLevelResult,
  TTarsDataSecurityAssignment,
  TTarsDataSecurityAssignmentSaveResult,
  TTarsDataSecurityAssignmentSavePayload,
} from 'librechat-data-provider';
import { tarsFetch } from './client';

/** pwc_tars `/api/data_security/*` answers `{success, message, data}`; a failure is a 4xx/5xx. */
interface TarsSecurityEnvelope<T> {
  success: boolean;
  message?: string;
  data?: T;
}

/**
 * Every label of a knowledge base with its assignees, disabled ones included. pwc_tars
 * lets only those who can open the knowledge base read or write these, so all three
 * calls go out as the acting user (`asUser`).
 */
export async function fetchTarsKnowledgeBaseSecurity(
  tarsId: string,
  knowledgeBaseId: string,
  baseUrl?: string,
): Promise<TTarsDataSecurityAssignment[]> {
  const envelope = await tarsFetch<TarsSecurityEnvelope<TTarsDataSecurityAssignment[]>>(
    '/api/data_security/assignments',
    { query: { knowledge_base_id: knowledgeBaseId }, asUser: tarsId, baseUrl },
  );
  return envelope?.data ?? [];
}

/** Overwrites one label's assignees in one knowledge base; pwc_tars validates the principals. */
export async function saveTarsKnowledgeBaseSecurity(
  tarsId: string,
  knowledgeBaseId: string,
  levelId: string,
  payload: TTarsDataSecurityAssignmentSavePayload,
  baseUrl?: string,
): Promise<TTarsDataSecurityAssignmentSaveResult | undefined> {
  const envelope = await tarsFetch<TarsSecurityEnvelope<TTarsDataSecurityAssignmentSaveResult>>(
    '/api/data_security/assignments/save',
    {
      method: 'POST',
      body: {
        knowledge_base_id: knowledgeBaseId,
        data_security_level_id: levelId,
        principals: payload?.principals,
      },
      asUser: tarsId,
      baseUrl,
    },
  );
  return envelope?.data;
}

/**
 * Sets or clears the level of a knowledge base's datasets. A missing level is left out
 * of the body on purpose: pwc_tars answers 400 unless clearing is an explicit `null`.
 */
export async function setTarsDatasetLevel(
  tarsId: string,
  knowledgeBaseId: string,
  input: TTarsDatasetLevelInput,
  baseUrl?: string,
): Promise<TTarsDatasetLevelResult | undefined> {
  const envelope = await tarsFetch<TarsSecurityEnvelope<TTarsDatasetLevelResult>>(
    '/api/data_security/datasets/level',
    {
      method: 'POST',
      body: {
        knowledge_base_id: knowledgeBaseId,
        data_security_level_id: input?.dataSecurityLevelId,
        document_ids: input?.documentIds,
        dataset_website_ids: input?.websiteIds,
        file_system_association_ids: input?.fileSystemAssociationIds,
      },
      asUser: tarsId,
      baseUrl,
    },
  );
  return envelope?.data;
}
