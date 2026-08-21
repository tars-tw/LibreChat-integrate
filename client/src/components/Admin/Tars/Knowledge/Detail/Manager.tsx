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
import type { TTarsDocument } from 'librechat-data-provider';
import {
  useTarsKnowledgeBaseDatasetsQuery,
  useBatchDeleteTarsDatasetsMutation,
} from '~/data-provider';
import FileSystemsTab from './FileSystemsTab';
import DatabasesTab from './DatabasesTab';
import DocumentsTab from './DocumentsTab';
import WebsitesTab from './WebsitesTab';
import { useLocalize } from '~/hooks';
import ChunkList from './ChunkList';
import Header from './Header';

/** `TabsContent` ships with `mt-2 p-6`; each panel owns its own spacing instead. */
const TAB_PANEL = 'mt-4 p-0';
/** The shared trigger only shifts the background when active, which reads as barely selected. */
const TAB_TRIGGER = 'data-[state=active]:text-brand-primary';

/** One knowledge base's datasets, split by kind. */
export default function KnowledgeDetailManager({ knowledgeBaseId }: { knowledgeBaseId: string }) {
  const localize = useLocalize();
  const { i18n } = useTranslation();
  const { showToast } = useToastContext();

  const datasetsQuery = useTarsKnowledgeBaseDatasetsQuery(knowledgeBaseId);
  const [chunkDoc, setChunkDoc] = useState<TTarsDocument | null>(null);

  const batchDeleteMutation = useBatchDeleteTarsDatasetsMutation(knowledgeBaseId, {
    /**
     * pwc_tars answers 202 and deletes on a background thread, so this reports
     * that the work started rather than claiming the rows are already gone.
     */
    onSuccess: (result) =>
      showToast({
        message: localize('com_ui_tars_kb_ds_batch_started', { 0: String(result.accepted) }),
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
        <TabsList className="w-fit">
          <TabsTrigger value="documents" className={TAB_TRIGGER}>
            {localize('com_ui_tars_kb_stat_documents')}
            {count(data?.documents.length ?? 0)}
          </TabsTrigger>
          <TabsTrigger value="websites" className={TAB_TRIGGER}>
            {localize('com_ui_tars_kb_stat_websites')}
            {count(data?.websites.length ?? 0)}
          </TabsTrigger>
          <TabsTrigger value="databases" className={TAB_TRIGGER}>
            {localize('com_ui_tars_kb_stat_database')}
            {count(data?.databases.length ?? 0)}
          </TabsTrigger>
          <TabsTrigger value="file-systems" className={TAB_TRIGGER}>
            {localize('com_ui_tars_kb_stat_file_systems')}
            {count(data?.file_systems.length ?? 0)}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="documents" className={TAB_PANEL}>
          <DocumentsTab
            knowledgeBaseId={knowledgeBaseId}
            documents={data?.documents ?? []}
            limits={
              data?.limits ?? { max_upload_counts: 5, max_chunk_size: 30000, max_overlap: 300 }
            }
            locale={locale}
            onRefresh={refresh}
            isRefreshing={isRefreshing}
            onViewChunks={setChunkDoc}
            onBatchDelete={(documentIds) => batchDeleteMutation.mutate({ documentIds })}
          />
        </TabsContent>

        <TabsContent value="websites" className={TAB_PANEL}>
          <WebsitesTab
            knowledgeBaseId={knowledgeBaseId}
            websites={data?.websites ?? []}
            locale={locale}
            onRefresh={refresh}
            isRefreshing={isRefreshing}
            onBatchDelete={(websiteIds) => batchDeleteMutation.mutate({ websiteIds })}
          />
        </TabsContent>

        <TabsContent value="databases" className={TAB_PANEL}>
          <DatabasesTab
            knowledgeBaseId={knowledgeBaseId}
            databases={data?.databases ?? []}
            available={data?.available_databases ?? []}
            locale={locale}
            onRefresh={refresh}
            isRefreshing={isRefreshing}
          />
        </TabsContent>

        <TabsContent value="file-systems" className={TAB_PANEL}>
          <FileSystemsTab
            knowledgeBaseId={knowledgeBaseId}
            links={data?.file_systems ?? []}
            documents={data?.documents ?? []}
            locale={locale}
            onRefresh={refresh}
            isRefreshing={isRefreshing}
          />
        </TabsContent>
      </Tabs>

      {chunkDoc != null && (
        <ChunkList
          document={chunkDoc}
          open={true}
          onOpenChange={(open) => !open && setChunkDoc(null)}
        />
      )}
    </div>
  );
}
