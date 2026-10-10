import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, LayoutGrid, List, Search, X } from 'lucide-react';
import {
  Input,
  Button,
  Switch,
  Spinner,
  OGDialog,
  OGDialogTemplate,
  useToastContext,
} from '@librechat/client';
import type { TTarsDocument, TTarsDatasetWebsite } from 'librechat-data-provider';
import type { ViewerChunk } from './chunks';
import {
  useTarsWebsiteChunksQuery,
  useTarsDocumentChunksQuery,
  useSetTarsChunkEnabledMutation,
} from '~/data-provider';
import { documentChunk, looksLikeMarkdown, preview, websiteChunk } from './chunks';
import MarkdownLite from '~/components/Chat/Messages/Content/MarkdownLite';
import Pagination, { usePagination } from '../Pagination';
import { relayedError } from '../helpers';
import { formatCount } from './helpers';
import { useLocalize } from '~/hooks';
import Highlight from './Highlight';

const LIST_PREVIEW = 160;
const CARD_PREVIEW = 220;

type ViewMode = 'list' | 'grid';

/** What the viewer is showing chunks of. */
export type ChunkSource =
  | { kind: 'document'; document: TTarsDocument }
  | { kind: 'website'; knowledgeBaseId: string; website: TTarsDatasetWebsite };

/**
 * A view of one dataset's chunks; a document chunk can be switched in or out of retrieval.
 * Website chunks are read-only: pwc_tars rebuilds them from the page on every sync.
 * Editing and deleting a chunk are left out until the deployed pwc_tars carries those routes.
 *
 * Reading a chunk swaps the dialog body rather than opening a second dialog:
 * a nested dialog inside an already-large one is hard to escape from, and the
 * reader needs the full width anyway.
 *
 * pwc_tars pages neither chunk endpoint, so the whole set arrives at once and
 * the filtering and paging below are what keep it off the DOM.
 */
export default function ChunkList({
  source,
  onClose,
}: {
  source: ChunkSource;
  onClose: () => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();

  const [search, setSearch] = useState('');
  const [view, setView] = useState<ViewMode>('list');
  /** Index into the filtered list, so prev/next walks what is on screen. */
  const [reading, setReading] = useState<number | null>(null);

  const documentQuery = useTarsDocumentChunksQuery(
    source.kind === 'document' ? source.document.id : null,
  );
  const websiteQuery = useTarsWebsiteChunksQuery(
    source.kind === 'website' ? source.knowledgeBaseId : '',
    source.kind === 'website' ? source.website.id : null,
  );

  const isLoading = source.kind === 'document' ? documentQuery.isLoading : websiteQuery.isLoading;

  const documentId = source.kind === 'document' ? source.document.id : '';
  const showError = (error: unknown) =>
    showToast({
      message: relayedError(error) ?? localize('com_ui_tars_admin_error'),
      status: 'error',
    });

  const enabledMutation = useSetTarsChunkEnabledMutation(documentId, {
    onSuccess: () => showToast({ message: localize('com_ui_saved'), status: 'success' }),
    onError: showError,
  });

  const chunks: ViewerChunk[] = useMemo(() => {
    if (source.kind === 'document') {
      return (documentQuery.data ?? []).map(documentChunk);
    }
    return (websiteQuery.data?.chunks ?? []).map(websiteChunk);
  }, [source.kind, documentQuery.data, websiteQuery.data]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle === ''
      ? chunks
      : chunks.filter((chunk) => chunk.content.toLowerCase().includes(needle));
  }, [chunks, search]);

  const paged = usePagination(filtered);

  const title =
    source.kind === 'document'
      ? source.document.filename
      : (source.website.name ?? source.website.url ?? '');

  const readingChunk = reading != null ? filtered[reading] : undefined;

  const meta = (chunk: ViewerChunk) => (
    <span className="text-text-secondary text-xs whitespace-nowrap tabular-nums">
      {localize('com_ui_tars_kb_ds_words')}: {formatCount(chunk.word_count)} ·{' '}
      {localize('com_ui_tars_kb_tokens')}: {formatCount(chunk.tokens)}
    </span>
  );

  const reader = () => {
    if (readingChunk == null) {
      return null;
    }
    const isMarkdown = looksLikeMarkdown(readingChunk.content);
    return (
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="outline" onClick={() => setReading(null)} className="gap-1.5">
            <ChevronLeft className="size-4" aria-hidden />
            {localize('com_ui_back')}
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              disabled={reading === 0}
              onClick={() => setReading((reading ?? 0) - 1)}
              aria-label={localize('com_ui_tars_kb_chunk_prev')}
              title={localize('com_ui_tars_kb_chunk_prev')}
            >
              <ChevronLeft className="size-4" aria-hidden />
            </Button>
            <span className="text-text-secondary text-sm tabular-nums">
              {(reading ?? 0) + 1} / {filtered.length}
            </span>
            <Button
              variant="ghost"
              size="icon"
              disabled={reading != null && reading >= filtered.length - 1}
              onClick={() => setReading((reading ?? 0) + 1)}
              aria-label={localize('com_ui_tars_kb_chunk_next')}
              title={localize('com_ui_tars_kb_chunk_next')}
            >
              <ChevronRight className="size-4" aria-hidden />
            </Button>
          </div>
        </div>

        <div className="bg-surface-secondary text-text-secondary flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg px-3 py-2 text-xs">
          <span>
            {localize('com_ui_tars_kb_chunk_position')}:{' '}
            <span className="text-text-primary font-medium tabular-nums">
              {readingChunk.position}
            </span>
          </span>
          <span>
            {localize('com_ui_tars_kb_ds_words')}:{' '}
            <span className="text-text-primary font-medium tabular-nums">
              {formatCount(readingChunk.word_count)}
            </span>
          </span>
          <span>
            {localize('com_ui_tars_kb_tokens')}:{' '}
            <span className="text-text-primary font-medium tabular-nums">
              {formatCount(readingChunk.tokens)}
            </span>
          </span>
          <span>
            {localize('com_ui_tars_kb_chunk_chars')}:{' '}
            <span className="text-text-primary font-medium tabular-nums">
              {formatCount(readingChunk.content.length)}
            </span>
          </span>
          <span className="ml-auto">
            {localize(isMarkdown ? 'com_ui_tars_kb_chunk_markdown' : 'com_ui_tars_kb_chunk_plain')}
          </span>
          {source.kind === 'document' && (
            <label className="flex items-center gap-2">
              {localize('com_ui_tars_kb_chunk_enabled_toggle')}
              <Switch
                checked={readingChunk.enabled}
                disabled={enabledMutation.isLoading}
                onCheckedChange={(checked) =>
                  enabledMutation.mutate({ chunkId: readingChunk.id, enabled: checked })
                }
                aria-label={localize('com_ui_tars_kb_chunk_enabled_toggle')}
              />
            </label>
          )}
        </div>

        <div className="data-table-scroll border-border-light max-h-[55vh] min-w-0 overflow-auto rounded-lg border p-4">
          {/*
            Markdown goes through the app's own renderer rather than the
            original page's regex-to-innerHTML: chunk content is whatever was in
            the uploaded file, so it is never trusted markup. Highlighting is
            therefore only applied to the plain-text branch, where the text stays
            React nodes all the way down.
          */}
          {isMarkdown ? (
            <MarkdownLite content={readingChunk.content} />
          ) : (
            <p className="text-text-primary text-sm break-words whitespace-pre-wrap">
              <Highlight text={readingChunk.content} query={search} />
            </p>
          )}
        </div>
      </div>
    );
  };

  const browser = () => (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] flex-1 sm:max-w-sm">
          <Search
            className="text-text-secondary pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={localize('com_ui_tars_kb_chunk_search')}
            aria-label={localize('com_ui_tars_kb_chunk_search')}
            className="px-9"
          />
          {search !== '' && (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setSearch('')}
              aria-label={localize('com_ui_clear')}
              title={localize('com_ui_clear')}
              className="absolute top-1/2 right-1.5 -translate-y-1/2"
            >
              <X className="size-3.5" aria-hidden />
            </Button>
          )}
        </div>

        <span className="text-text-secondary text-sm">
          {search.trim() === ''
            ? localize('com_ui_tars_kb_chunk_count', { count: chunks.length })
            : localize('com_ui_tars_kb_chunk_found', {
                0: String(filtered.length),
                1: String(chunks.length),
              })}
        </span>

        <div className="border-border-light ml-auto flex items-center rounded-lg border p-0.5">
          {(
            [
              ['list', List, 'com_ui_tars_kb_view_table'],
              ['grid', LayoutGrid, 'com_ui_tars_kb_view_grid'],
            ] as const
          ).map(([mode, Icon, labelKey]) => (
            <Button
              key={mode}
              variant="ghost"
              size="icon"
              onClick={() => setView(mode)}
              aria-label={localize(labelKey)}
              title={localize(labelKey)}
              aria-pressed={view === mode}
              className={
                view === mode ? 'bg-surface-tertiary text-text-primary' : 'text-text-secondary'
              }
            >
              <Icon className="size-4" aria-hidden />
            </Button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-text-secondary py-12 text-center text-sm">
          {localize(
            chunks.length === 0 ? 'com_ui_tars_kb_no_chunks' : 'com_ui_tars_kb_ds_no_match',
          )}
        </p>
      ) : (
        <>
          <div
            className={
              view === 'grid' ? 'grid gap-3 sm:grid-cols-2 xl:grid-cols-3' : 'flex flex-col gap-2'
            }
          >
            {paged.rows.map((chunk) => {
              const index = filtered.indexOf(chunk);
              return (
                <button
                  key={chunk.id}
                  type="button"
                  onClick={() => setReading(index)}
                  className={`border-border-light hover:border-border-heavy hover:bg-surface-hover min-w-0 rounded-lg border p-3 text-left transition-colors ${
                    view === 'grid' ? 'flex flex-col gap-2' : 'flex items-start gap-3'
                  } ${chunk.enabled ? '' : 'opacity-60'}`}
                >
                  <span className="bg-brand-primary-subtle text-brand-primary shrink-0 rounded-md px-2 py-0.5 text-xs font-medium tabular-nums">
                    #{chunk.position}
                  </span>
                  {!chunk.enabled && (
                    <span className="bg-surface-tertiary text-text-secondary shrink-0 rounded-md px-2 py-0.5 text-xs">
                      {localize('com_ui_disabled')}
                    </span>
                  )}
                  <span
                    className={`text-text-primary min-w-0 flex-1 text-sm break-words ${
                      view === 'grid' ? 'line-clamp-4' : 'line-clamp-2'
                    }`}
                  >
                    <Highlight
                      text={preview(chunk.content, view === 'grid' ? CARD_PREVIEW : LIST_PREVIEW)}
                      query={search}
                    />
                  </span>
                  {view === 'grid' ? (
                    <span className="border-border-light mt-auto border-t pt-2">{meta(chunk)}</span>
                  ) : (
                    <span className="shrink-0">{meta(chunk)}</span>
                  )}
                </button>
              );
            })}
          </div>

          <Pagination state={paged} />
        </>
      )}
    </div>
  );

  /** Loading, reading and browsing are three states, not a nested ternary. */
  const body = () => {
    if (isLoading) {
      return (
        <div className="flex h-64 items-center justify-center">
          <Spinner />
        </div>
      );
    }
    return reading != null ? reader() : browser();
  };

  return (
    <OGDialog open={true} onOpenChange={(open) => !open && onClose()}>
      <OGDialogTemplate
        title={localize('com_ui_tars_kb_chunks_of', { name: title })}
        showCloseButton={true}
        className="w-11/12 md:max-w-4xl"
        mainClassName="min-w-0"
        main={body()}
      />
    </OGDialog>
  );
}
