import { ArrowRight, Clock } from 'lucide-react';
import { OGDialog, OGDialogTemplate } from '@librechat/client';
import type { TTarsJsonField, TTarsActionLog, TTarsActionLogModule } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import { hasJsonValue, moduleLabel, prettyJson, statusTone } from './helpers';
import { formatDateTime } from '../Users/helpers';
import ActionBadge from './ActionBadge';
import { useLocalize } from '~/hooks';

/** One labelled value. `—` rather than a blank keeps the grid legible. */
function Field({ label, value, wide }: { label: string; value: string | null; wide?: boolean }) {
  return (
    <div className={wide === true ? 'sm:col-span-2' : undefined}>
      <p className="text-xs text-text-secondary">{label}</p>
      <p className="break-words text-sm text-text-primary">
        {value == null || value === '' ? '—' : value}
      </p>
    </div>
  );
}

function Json({ label, value }: { label: string; value: TTarsJsonField }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="mb-1 text-xs text-text-secondary">{label}</p>
      <pre className="data-table-scroll max-h-72 overflow-auto rounded-lg bg-surface-secondary p-2 text-xs text-text-primary">
        {prettyJson(value)}
      </pre>
    </div>
  );
}

/**
 * Everything pwc_tars recorded about one operation.
 *
 * The list endpoint already returns every column, so this reads the row in hand
 * rather than re-fetching `/audit_logs/<id>` — the original page does the same.
 */
export default function DetailDialog({
  log,
  modules,
  locale,
  onClose,
}: {
  log: TTarsActionLog | null;
  modules: TTarsActionLogModule[];
  locale: string;
  onClose: () => void;
}) {
  const localize = useLocalize();

  const field = (key: TranslationKeys, value: string | null, wide?: boolean) => (
    <Field label={localize(key)} value={value} wide={wide} />
  );

  return (
    <OGDialog open={log != null} onOpenChange={(open) => !open && onClose()}>
      <OGDialogTemplate
        title={localize('com_ui_tars_ops_detail_title')}
        showCloseButton={true}
        className="w-11/12 md:max-w-5xl"
        /**
         * The dialog body is a grid item, and a grid item defaults to
         * `min-width: auto` — the wide JSON panels would otherwise stretch the
         * track, pushing the footer buttons outside the dialog.
         */
        mainClassName="min-w-0"
        main={
          log == null ? null : (
            <div className="max-h-[70vh] min-w-0 space-y-5 overflow-y-auto pr-1">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <ActionBadge action={log.action_type} />
                <span className="flex items-center gap-1.5 text-sm text-text-secondary">
                  <Clock className="size-4" aria-hidden />
                  {formatDateTime(log.created_at, locale)}
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {field('com_ui_tars_audit_col_user', log.username)}
                {field('com_ui_tars_ops_detail_email', log.user_email)}
                {field('com_ui_tars_ops_col_module', moduleLabel(log.module, modules))}
                <div>
                  <p className="text-xs text-text-secondary">
                    {localize('com_ui_tars_ops_col_status')}
                  </p>
                  <p className={`text-sm ${statusTone(log.status)}`}>{log.status ?? '—'}</p>
                </div>
                {field('com_ui_tars_ops_detail_target_type', log.target_type)}
                {field('com_ui_tars_ops_detail_target_id', log.target_id)}
                {field('com_ui_tars_ops_detail_target_name', log.target_name, true)}
                {field('com_ui_tars_ops_detail_description', log.description, true)}
              </div>

              {(hasJsonValue(log.before_data) || hasJsonValue(log.after_data)) && (
                <div>
                  <p className="mb-2 text-sm font-medium text-text-primary">
                    {localize('com_ui_tars_ops_detail_changes')}
                  </p>
                  <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                    <Json
                      label={localize('com_ui_tars_ops_detail_before')}
                      value={log.before_data}
                    />
                    <ArrowRight
                      className="mx-auto size-4 shrink-0 rotate-90 text-text-secondary sm:rotate-0"
                      aria-hidden
                    />
                    <Json label={localize('com_ui_tars_ops_detail_after')} value={log.after_data} />
                  </div>
                </div>
              )}

              {log.error_message != null && log.error_message !== '' && (
                <div>
                  <p className="text-xs text-text-secondary">
                    {localize('com_ui_tars_ops_detail_error')}
                  </p>
                  <p className="break-words text-sm text-pwc-danger">{log.error_message}</p>
                </div>
              )}

              <div className="grid gap-3 border-t border-border-light pt-4 sm:grid-cols-2">
                {field('com_ui_tars_ops_detail_http_method', log.http_method)}
                {field('com_ui_tars_audit_col_ip', log.ip_address)}
                {field('com_ui_tars_ops_detail_api_endpoint', log.api_endpoint, true)}
                {field('com_ui_tars_ops_detail_page_url', log.page_url, true)}
                {field('com_ui_tars_ops_detail_trace_id', log.trace_id, true)}
              </div>

              {hasJsonValue(log.extra) && (
                <Json label={localize('com_ui_tars_ops_detail_extra')} value={log.extra} />
              )}
            </div>
          )
        }
      />
    </OGDialog>
  );
}
