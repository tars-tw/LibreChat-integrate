import { useMemo, useState } from 'react';
import { Globe, Plus, Search } from 'lucide-react';
import {
  Button,
  Dropdown,
  Input,
  OGDialog,
  OGDialogTemplate,
  Spinner,
  useToastContext,
} from '@librechat/client';
import type { TTarsWebsiteSource } from 'librechat-data-provider';
import { useTarsWebsitesQuery, useDeleteTarsWebsiteSourceMutation } from '~/data-provider';
import ChunkList from '../Knowledge/Detail/ChunkList';
import { filterWebsites } from './helpers';
import WebsiteDetails from './Details';
import { useLocalize } from '~/hooks';
import WebsiteTable from './Table';
import WebsiteModal from './Modal';

/**
 * The shared Dropdown treats an empty value as "nothing selected" and renders
 * a blank trigger, so the catch-all option needs a value of its own.
 */
const ALL_KNOWLEDGE_BASES = '__all__';

/**
 * Website administration (資料源管理 → 外部網站): every crawled site across all
 * knowledge bases, and the one place to import a new one.
 */
export default function WebsiteManager() {
  const localize = useLocalize();
  const { showToast } = useToastContext();

  const websitesQuery = useTarsWebsitesQuery();

  const websites = useMemo(() => websitesQuery.data?.websites ?? [], [websitesQuery.data]);
  const knowledgeBases = useMemo(
    () => websitesQuery.data?.knowledgeBases ?? [],
    [websitesQuery.data],
  );

  const [search, setSearch] = useState('');
  const [knowledgeBaseId, setKnowledgeBaseId] = useState<string>(ALL_KNOWLEDGE_BASES);
  /** `undefined` = closed, `null` = import, a row = edit. */
  const [editing, setEditing] = useState<TTarsWebsiteSource | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<TTarsWebsiteSource | null>(null);
  const [details, setDetails] = useState<TTarsWebsiteSource | null>(null);
  const [chunksOf, setChunksOf] = useState<TTarsWebsiteSource | null>(null);

  const filtered = useMemo(
    () =>
      filterWebsites(
        websites,
        search,
        knowledgeBaseId === ALL_KNOWLEDGE_BASES ? '' : knowledgeBaseId,
      ),
    [websites, search, knowledgeBaseId],
  );

  const deleteMutation = useDeleteTarsWebsiteSourceMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_web_deleted'), status: 'success' });
      setDeleting(null);
    },
    onError: () =>
      showToast({ message: localize('com_ui_tars_web_delete_failed'), status: 'error' }),
  });

  const knowledgeBaseOptions = [
    { value: ALL_KNOWLEDGE_BASES, label: localize('com_ui_tars_web_all_knowledge_bases') },
    ...knowledgeBases.map((kb) => ({ value: kb.id, label: kb.name })),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[16rem] flex-1 sm:max-w-sm">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-secondary"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={localize('com_ui_tars_web_search')}
            aria-label={localize('com_ui_tars_web_search')}
            className="pl-9"
          />
        </div>

        <Dropdown
          value={knowledgeBaseId}
          onChange={setKnowledgeBaseId}
          options={knowledgeBaseOptions}
          aria-label={localize('com_ui_tars_web_knowledge_base')}
          sizeClasses="min-w-[12rem]"
        />

        <Button variant="submit" onClick={() => setEditing(null)} className="gap-1.5">
          <Plus className="size-4" aria-hidden />
          {localize('com_ui_tars_web_new')}
        </Button>
      </div>

      {websitesQuery.isLoading && (
        <div className="flex h-40 items-center justify-center">
          <Spinner />
        </div>
      )}

      {!websitesQuery.isLoading && filtered.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-16 text-sm text-text-secondary">
          <Globe className="size-10 text-text-tertiary" aria-hidden />
          {localize(
            websites.length === 0 ? 'com_ui_tars_web_empty' : 'com_ui_tars_web_no_search_results',
          )}
        </div>
      )}

      {!websitesQuery.isLoading && filtered.length > 0 && (
        <WebsiteTable
          websites={filtered}
          onEdit={setEditing}
          onDelete={setDeleting}
          onDetails={setDetails}
          onChunks={setChunksOf}
        />
      )}

      {editing !== undefined && (
        <WebsiteModal
          website={editing}
          knowledgeBases={knowledgeBases}
          onClose={() => setEditing(undefined)}
        />
      )}

      {details != null && <WebsiteDetails website={details} onClose={() => setDetails(null)} />}

      {chunksOf != null && chunksOf.knowledge_base_id != null && (
        <ChunkList
          source={{
            kind: 'website',
            knowledgeBaseId: chunksOf.knowledge_base_id,
            website: chunksOf,
          }}
          onClose={() => setChunksOf(null)}
        />
      )}

      {deleting != null && (
        <OGDialog open={true} onOpenChange={(open) => !open && setDeleting(null)}>
          <OGDialogTemplate
            title={localize('com_ui_tars_web_delete')}
            className="w-11/12 max-w-md"
            showCloseButton={true}
            main={
              <div className="space-y-2">
                <p className="text-sm text-text-secondary">
                  {localize('com_ui_tars_db_delete_confirm_named', { 0: deleting.name ?? '' })}
                </p>
                <p className="rounded-lg border border-border-light p-3 text-sm text-text-secondary">
                  {localize('com_ui_tars_web_delete_warning')}
                </p>
              </div>
            }
            buttons={
              <Button
                variant="destructive"
                onClick={() =>
                  deleteMutation.mutate({
                    id: deleting.id,
                    knowledgeBaseId: deleting.knowledge_base_id,
                  })
                }
                disabled={deleteMutation.isLoading}
              >
                {deleteMutation.isLoading ? <Spinner /> : localize('com_ui_delete')}
              </Button>
            }
          />
        </OGDialog>
      )}
    </div>
  );
}
