import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useToastContext,
} from '@librechat/client';
import type { TTarsDocument, TTarsDatasetWebsite } from 'librechat-data-provider';
import type { ReactNode } from 'react';
import type { ChunkSource } from './ChunkList';
import {
  useTarsKnowledgeBaseDatasetsQuery,
  useTarsKnowledgeBaseSecurityQuery,
  useBatchDeleteTarsDatasetsMutation,
} from '~/data-provider';
import FileSystemsTab from './FileSystemsTab';
import SchedulesTab from './SchedulesTab';
import DatabasesTab from './DatabasesTab';
import DocumentsTab from './DocumentsTab';
import WebsitesTab from './WebsitesTab';
import SecurityTab from './SecurityTab';
import { useLocalize } from '~/hooks';
import ChunkList from './ChunkList';
import Header from './Header';

/** `TabsContent` ships with `mt-2 p-6`; each panel owns its own spacing instead. */
const Panel = ({ value, children }: { value: string; children: ReactNode }) => (
  <TabsContent value={value} className="mt-4 p-0">
    {children}
  </TabsContent>
);

/** One knowledge base's datasets, split by kind. */
export default function KnowledgeDetailManager({ knowledgeBaseId }: { knowledgeBaseId: string }) {
  const localize = useLocalize();
  const { i18n } = useTranslation();
  const { showToast } = useToastContext();

  const datasetsQuery = useTarsKnowledgeBaseDatasetsQuery(knowledgeBaseId);
  const securityQuery = useTarsKnowledgeBaseSecurityQuery(knowledgeBaseId);
  const [chunkSource, setChunkSource] = useState<ChunkSource | null>(null);

  const batchDeleteMutation = useBatchDeleteTarsDatasetsMutation(knowledgeBaseId, {
    /**
     * pwc_tars answers 202 and deletes on a background thread, so this reports
     * that the work started rather than claiming the rows are already gone.
     */
    onSuccess: (result, variables) =>
      showToast({
        message:
          (variables.fileSystemAssociationIds?.length ?? 0) > 0
            ? localize('com_ui_tars_kb_ds_batch_unlink_started', { 0: String(result.accepted) })
            : localize('com_ui_tars_kb_ds_batch_started', { 0: String(result.accepted) }),
        status: 'success',
      }),
    onError: () => showToast({ message: localize('com_ui_tars_admin_error'), status: 'error' }),
  });

  if (datasetsQuery.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const data = datasetsQuery.data;
  const levels = securityQuery.data ?? [];
  const locale = i18n.language;
  const refresh = () => void datasetsQuery.refetch();
  const isRefreshing = datasetsQuery.isFetching;

  const count = (value: number) => (value > 0 ? ` (${value})` : '');

  return (
    <div className="space-y-6">
      <Header
        knowledgeBaseId={knowledgeBaseId}
        knowledgeBase={data?.knowledge_base ?? null}
        stats={
          data?.stats ?? {
            document_count: 0,
            total_word_count: 0,
            total_token_count: 0,
            api_count: 0,
          }
        }
        limits={data?.limits ?? { max_upload_counts: 5, max_chunk_size: 30000, max_overlap: 300 }}
      />

      <Tabs defaultValue="documents">
        <TabsList variant="underline">
          <TabsTrigger value="documents" variant="underline">
            {localize('com_ui_tars_kb_stat_documents')}
            {count(data?.documents.length ?? 0)}
          </TabsTrigger>
          <TabsTrigger value="websites" variant="underline">
            {localize('com_ui_tars_kb_stat_websites')}
            {count(data?.websites.length ?? 0)}
          </TabsTrigger>
          <TabsTrigger value="databases" variant="underline">
            {localize('com_ui_tars_kb_stat_database')}
            {count(data?.databases.length ?? 0)}
          </TabsTrigger>
          <TabsTrigger value="file-systems" variant="underline">
            {localize('com_ui_tars_kb_stat_file_systems')}
            {count(data?.file_systems.length ?? 0)}
          </TabsTrigger>
          <TabsTrigger value="schedules" variant="underline">
            {localize('com_ui_tars_nav_kb_schedule')}
          </TabsTrigger>
          <TabsTrigger value="security" variant="underline">
            {localize('com_ui_tars_kb_security_tab')}
          </TabsTrigger>
        </TabsList>

        <Panel value="documents">
          <DocumentsTab
            knowledgeBaseId={knowledgeBaseId}
            documents={data?.documents ?? []}
            levels={levels}
            limits={
              data?.limits ?? { max_upload_counts: 5, max_chunk_size: 30000, max_overlap: 300 }
            }
            locale={locale}
            onRefresh={refresh}
            isRefreshing={isRefreshing}
            onViewChunks={(document: TTarsDocument) =>
              setChunkSource({ kind: 'document', document })
            }
            onBatchDelete={(documentIds) => batchDeleteMutation.mutate({ documentIds })}
          />
        </Panel>

        <Panel value="websites">
          <WebsitesTab
            knowledgeBaseId={knowledgeBaseId}
            websites={data?.websites ?? []}
            levels={levels}
            locale={locale}
            onRefresh={refresh}
            isRefreshing={isRefreshing}
            onBatchDelete={(websiteIds) => batchDeleteMutation.mutate({ websiteIds })}
            onViewChunks={(website: TTarsDatasetWebsite) =>
              setChunkSource({ kind: 'website', knowledgeBaseId, website })
            }
          />
        </Panel>

        <Panel value="databases">
          <DatabasesTab
            knowledgeBaseId={knowledgeBaseId}
            databases={data?.databases ?? []}
            available={data?.available_databases ?? []}
            locale={locale}
            onRefresh={refresh}
            isRefreshing={isRefreshing}
          />
        </Panel>

        <Panel value="file-systems">
          <FileSystemsTab
            knowledgeBaseId={knowledgeBaseId}
            links={data?.file_systems ?? []}
            documents={data?.documents ?? []}
            levels={levels}
            limits={
              data?.limits ?? { max_upload_counts: 5, max_chunk_size: 30000, max_overlap: 300 }
            }
            locale={locale}
            onRefresh={refresh}
            isRefreshing={isRefreshing}
            onBatchUnlink={(fileSystemAssociationIds) =>
              batchDeleteMutation.mutate({ fileSystemAssociationIds })
            }
            isBatchUnlinking={batchDeleteMutation.isLoading}
            onViewChunks={(document: TTarsDocument) =>
              setChunkSource({ kind: 'document', document })
            }
          />
        </Panel>

        <Panel value="schedules">
          <SchedulesTab knowledgeBaseId={knowledgeBaseId} locale={locale} />
        </Panel>

        <Panel value="security">
          <SecurityTab
            knowledgeBaseId={knowledgeBaseId}
            levels={levels}
            isLoading={securityQuery.isLoading}
            isError={securityQuery.isError}
          />
        </Panel>
      </Tabs>

      {chunkSource != null && (
        <ChunkList source={chunkSource} onClose={() => setChunkSource(null)} />
      )}
    </div>
  );
}
