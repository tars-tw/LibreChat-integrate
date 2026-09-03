import { Button } from '@librechat/client';
import { ExternalLink, Info, LayoutList, Pencil, Trash2 } from 'lucide-react';
import type { TTarsWebsiteSource } from 'librechat-data-provider';
import Pagination, { usePagination } from '../Knowledge/Pagination';
import { formatCount } from '../Knowledge/Detail/helpers';
import { useLocalize } from '~/hooks';

/**
 * The website master list.
 *
 * The word and token counts are what pwc_tars wrote back after crawling, so a
 * row showing zeros is one whose import produced nothing — that is worth
 * seeing without opening anything.
 */
export default function WebsiteTable({
  websites,
  onEdit,
  onDelete,
  onDetails,
  onChunks,
}: {
  websites: TTarsWebsiteSource[];
  onEdit: (website: TTarsWebsiteSource) => void;
  onDelete: (website: TTarsWebsiteSource) => void;
  onDetails: (website: TTarsWebsiteSource) => void;
  onChunks: (website: TTarsWebsiteSource) => void;
}) {
  const localize = useLocalize();
  const paged = usePagination(websites);

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-border-light">
        <table className="w-full min-w-[64rem] border-collapse text-sm">
          <thead className="bg-surface-secondary">
            <tr className="text-left text-text-secondary">
              <th className="w-[20%] px-3 py-2 font-medium">{localize('com_ui_tars_web_name')}</th>
              <th className="w-[26%] px-3 py-2 font-medium">{localize('com_ui_tars_web_url')}</th>
              <th className="w-[18%] px-3 py-2 font-medium">
                {localize('com_ui_tars_web_knowledge_base')}
              </th>
              <th className="px-3 py-2 text-right font-medium">
                {localize('com_ui_tars_web_word_count')}
              </th>
              <th className="px-3 py-2 text-right font-medium">
                {localize('com_ui_tars_web_tokens')}
              </th>
              <th className="px-3 py-2 font-medium">{localize('com_ui_tars_users_status')}</th>
              <th className="px-3 py-2 text-right font-medium">{localize('com_ui_actions')}</th>
            </tr>
          </thead>
          <tbody>
            {paged.rows.map((website) => {
              const bound = website.knowledge_base_id != null && website.knowledge_base_id !== '';

              return (
                <tr
                  key={website.id}
                  className="border-t border-border-light hover:bg-surface-hover"
                >
                  <td className="max-w-0 px-3 py-1.5">
                    <button
                      type="button"
                      onClick={() => onEdit(website)}
                      className="block w-full truncate text-left font-medium text-text-primary hover:underline"
                      title={website.name ?? undefined}
                    >
                      {website.name ?? '—'}
                    </button>
                  </td>
                  <td className="max-w-0 px-3 py-1.5">
                    <a
                      href={website.url ?? '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 truncate text-text-secondary hover:text-text-primary hover:underline"
                      title={website.url ?? undefined}
                    >
                      <span className="truncate">{website.url ?? '—'}</span>
                      <ExternalLink className="size-3 shrink-0" aria-hidden />
                    </a>
                  </td>
                  <td className="max-w-0 px-3 py-1.5">
                    {bound ? (
                      <span
                        className="block truncate text-text-secondary"
                        title={website.knowledge_base_name ?? undefined}
                      >
                        {website.knowledge_base_name ?? website.knowledge_base_id}
                      </span>
                    ) : (
                      <span className="text-text-tertiary">
                        {localize('com_ui_tars_web_unbound')}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-text-secondary">
                    {formatCount(website.word_count)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-text-secondary">
                    {formatCount(website.tokens)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5">
                    <span
                      className={
                        website.status === 0 ? 'text-text-tertiary' : 'text-text-secondary'
                      }
                    >
                      {localize(
                        website.status === 0
                          ? 'com_ui_tars_db_status_disabled'
                          : 'com_ui_tars_db_status_enabled',
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex justify-end">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        /** Chunks live under the knowledge base; an unbound row has none. */
                        disabled={!bound}
                        onClick={() => onChunks(website)}
                        aria-label={localize('com_ui_tars_web_chunks')}
                        title={localize(
                          bound ? 'com_ui_tars_web_chunks' : 'com_ui_tars_web_chunks_unavailable',
                        )}
                        className="text-text-secondary"
                      >
                        <LayoutList className="size-4" aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => onDetails(website)}
                        aria-label={localize('com_ui_tars_db_details')}
                        title={localize('com_ui_tars_db_details')}
                        className="text-text-secondary"
                      >
                        <Info className="size-4" aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => onEdit(website)}
                        aria-label={localize('com_ui_edit')}
                        title={localize('com_ui_edit')}
                        className="text-text-secondary"
                      >
                        <Pencil className="size-4" aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => onDelete(website)}
                        aria-label={localize('com_ui_delete')}
                        title={localize('com_ui_delete')}
                        className="text-pwc-danger"
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination state={paged} />
    </div>
  );
}
