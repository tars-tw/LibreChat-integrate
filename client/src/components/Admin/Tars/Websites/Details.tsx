import { ExternalLink } from 'lucide-react';
import { Button, OGDialog, OGDialogTemplate } from '@librechat/client';
import type { TTarsWebsiteSource } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import { formatCount } from '../Knowledge/Detail/helpers';
import { useLocalize } from '~/hooks';

/**
 * Everything pwc_tars stores about one website dataset.
 *
 * The crawl results (size, chunk size, tokens) are written back by the import,
 * so this is where an operator confirms what a run actually produced.
 */
export default function WebsiteDetails({
  website,
  onClose,
}: {
  website: TTarsWebsiteSource;
  onClose: () => void;
}) {
  const localize = useLocalize();

  const row = (labelKey: TranslationKeys, value: string) => (
    <div className="grid grid-cols-3 gap-3 py-1.5">
      <dt className="text-text-secondary">{localize(labelKey)}</dt>
      <dd className="col-span-2 break-words text-text-primary">{value === '' ? '—' : value}</dd>
    </div>
  );

  return (
    <OGDialog open={true} onOpenChange={(open) => !open && onClose()}>
      <OGDialogTemplate
        title={website.name ?? localize('com_ui_tars_web_details')}
        showCloseButton={true}
        className="w-11/12 max-w-lg"
        main={
          <div className="space-y-3">
            <a
              href={website.url ?? '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 break-all text-sm text-text-primary hover:underline"
            >
              {website.url ?? '—'}
              <ExternalLink className="size-3.5 shrink-0" aria-hidden />
            </a>

            <dl className="divide-y divide-border-light text-sm">
              {row('com_ui_description', website.description ?? '')}
              {row(
                'com_ui_tars_web_knowledge_base',
                website.knowledge_base_name ??
                  website.knowledge_base_id ??
                  localize('com_ui_tars_web_unbound'),
              )}
              {row(
                'com_ui_tars_users_status',
                localize(
                  website.status === 0
                    ? 'com_ui_tars_db_status_disabled'
                    : 'com_ui_tars_db_status_enabled',
                ),
              )}
              {row('com_ui_tars_web_word_count', formatCount(website.word_count))}
              {row('com_ui_tars_web_tokens', formatCount(website.tokens))}
              {row('com_ui_tars_web_size', formatCount(website.size))}
              {row('com_ui_tars_web_chunk_size', formatCount(website.chunk_size))}
              {row('com_ui_tars_web_tags', website.tags ?? '')}
              {row('com_ui_tars_web_metatype', website.website_metatype ?? '')}
              {row('com_ui_tars_web_created_by', website.created_by ?? '')}
              {row('com_ui_tars_db_created_at', website.created_at ?? '')}
              {row('com_ui_tars_web_updated_by', website.updated_by ?? '')}
              {row('com_ui_tars_db_updated_at', website.updated_at ?? '')}
            </dl>
          </div>
        }
        buttons={
          <Button variant="outline" onClick={onClose}>
            {localize('com_ui_close')}
          </Button>
        }
      />
    </OGDialog>
  );
}
