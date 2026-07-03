import { useQuery } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type { UseQueryOptions, QueryObserverResult } from '@tanstack/react-query';
import type {
  TTarsDomain,
  TTarsChunk,
  TTarsDocument,
  TTarsSysConfig,
  TTarsModelOptions,
  TTarsChunksResponse,
  TTarsDomainsResponse,
  TTarsKnowledgeBase,
  TTarsPromptsResponse,
  TTarsDocumentsResponse,
  TTarsDomainPrepareData,
  TTarsSysConfigsResponse,
} from 'librechat-data-provider';

/** pwc_tars document status: 0 uploaded, 1 processing, 2 completed, 4 failed. */
const PROCESSING_STATUSES = new Set([0, 1]);

const adminQueryOptions = {
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  refetchOnMount: false,
} as const;

/**
 * Lists the pwc_tars specialized brains (專用腦) the authenticated user may
 * access. Returns [] for non-tars users or when the integration is unconfigured.
 */
export const useTarsDomainsQuery = (
  config?: UseQueryOptions<TTarsDomainsResponse, unknown, TTarsDomain[]>,
): QueryObserverResult<TTarsDomain[]> => {
  return useQuery<TTarsDomainsResponse, unknown, TTarsDomain[]>(
    [QueryKeys.tarsDomains],
    () => dataService.getTarsDomains(),
    {
      select: (data) => data.domains ?? [],
      ...adminQueryOptions,
      ...config,
    },
  );
};

/** Admin: all domains, knowledge bases and roles for the domain editor. */
export const useTarsDomainPrepareDataQuery = (
  config?: UseQueryOptions<TTarsDomainPrepareData>,
): QueryObserverResult<TTarsDomainPrepareData> => {
  return useQuery<TTarsDomainPrepareData>(
    [QueryKeys.tarsDomainPrepareData],
    () => dataService.getTarsDomainPrepareData(),
    { ...adminQueryOptions, ...config },
  );
};

/** Admin: knowledge bases with document/chunk/token stats. */
export const useTarsKnowledgeBasesQuery = (
  config?: UseQueryOptions<{ knowledgeBases: TTarsKnowledgeBase[] }, unknown, TTarsKnowledgeBase[]>,
): QueryObserverResult<TTarsKnowledgeBase[]> => {
  return useQuery<{ knowledgeBases: TTarsKnowledgeBase[] }, unknown, TTarsKnowledgeBase[]>(
    [QueryKeys.tarsKnowledgeBases],
    () => dataService.getTarsKnowledgeBases(),
    {
      select: (data) => data.knowledgeBases ?? [],
      ...adminQueryOptions,
      ...config,
    },
  );
};

/**
 * Documents inside a knowledge base. Polls every 5s while any document is still
 * uploading/processing so status badges update without a manual refresh.
 */
export const useTarsKnowledgeBaseDocumentsQuery = (
  knowledgeBaseId?: string | null,
  config?: UseQueryOptions<TTarsDocumentsResponse, unknown, TTarsDocument[]>,
): QueryObserverResult<TTarsDocument[]> => {
  return useQuery<TTarsDocumentsResponse, unknown, TTarsDocument[]>(
    [QueryKeys.tarsKnowledgeBaseDocuments, knowledgeBaseId],
    () => dataService.getTarsKnowledgeBaseDocuments(knowledgeBaseId ?? ''),
    {
      enabled: !!knowledgeBaseId,
      select: (data) => data.documents ?? [],
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchInterval: (data) =>
        (data ?? []).some((doc) => PROCESSING_STATUSES.has(doc.status)) ? 5000 : false,
      ...config,
    },
  );
};

/** Chunks of a document. Disabled until a `documentId` is known. */
export const useTarsDocumentChunksQuery = (
  documentId?: string | null,
  config?: UseQueryOptions<TTarsChunksResponse, unknown, TTarsChunk[]>,
): QueryObserverResult<TTarsChunk[]> => {
  return useQuery<TTarsChunksResponse, unknown, TTarsChunk[]>(
    [QueryKeys.tarsDocumentChunks, documentId],
    () => dataService.getTarsDocumentChunks(documentId ?? ''),
    {
      enabled: !!documentId,
      select: (data) => data.chunks ?? [],
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      ...config,
    },
  );
};

/**
 * The three-tier "我的提示" list (personal + specialized brain + its knowledge
 * bases) for the given brain. Disabled until a `domainId` is known.
 */
export const useTarsPromptsQuery = (
  domainId?: string | null,
  config?: UseQueryOptions<TTarsPromptsResponse>,
): QueryObserverResult<TTarsPromptsResponse> => {
  return useQuery<TTarsPromptsResponse>(
    [QueryKeys.tarsPrompts, domainId],
    () => dataService.getTarsPrompts(domainId ?? undefined),
    {
      enabled: !!domainId,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      ...config,
    },
  );
};

/** Admin: pwc_tars 系統參數設定 rows. */
export const useTarsSysConfigsQuery = (
  config?: UseQueryOptions<TTarsSysConfigsResponse, unknown, TTarsSysConfig[]>,
): QueryObserverResult<TTarsSysConfig[]> => {
  return useQuery<TTarsSysConfigsResponse, unknown, TTarsSysConfig[]>(
    [QueryKeys.tarsSysConfigs],
    () => dataService.getTarsSysConfigs(),
    {
      select: (data) => data.sysConfigs ?? [],
      ...adminQueryOptions,
      ...config,
    },
  );
};

/** Admin: LLM / embedding / rerank model options for the upload form. */
export const useTarsModelOptionsQuery = (
  config?: UseQueryOptions<TTarsModelOptions>,
): QueryObserverResult<TTarsModelOptions> => {
  return useQuery<TTarsModelOptions>(
    [QueryKeys.tarsModelOptions],
    () => dataService.getTarsKnowledgeBaseModels(),
    { ...adminQueryOptions, ...config },
  );
};
