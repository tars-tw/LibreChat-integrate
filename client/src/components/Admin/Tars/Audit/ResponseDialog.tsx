import { OGDialog, OGDialogTemplate } from '@librechat/client';
import MarkdownLite from '~/components/Chat/Messages/Content/MarkdownLite';
import { useLocalize } from '~/hooks';

/** The pair the dialog shows; null closes it. */
export interface ResponsePair {
  query: string | null;
  response: string | null;
}

/**
 * The full question and model response for one audited message.
 *
 * The response is rendered through the same Markdown pipeline the chat uses, so
 * tables, code blocks and math read here exactly as the user originally saw
 * them. Code execution is off — an auditor is reading history, not running it.
 */
export default function ResponseDialog({
  pair,
  onClose,
}: {
  pair: ResponsePair | null;
  onClose: () => void;
}) {
  const localize = useLocalize();

  return (
    <OGDialog open={pair != null} onOpenChange={(open) => !open && onClose()}>
      <OGDialogTemplate
        title={localize('com_ui_tars_audit_col_response')}
        showCloseButton={true}
        className="w-11/12 md:max-w-4xl"
        main={
          <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
            <div className="border-border-medium bg-surface-secondary rounded-lg border-l-4 p-3">
              <p className="text-text-secondary mb-1 text-xs font-semibold tracking-wide uppercase">
                {localize('com_ui_tars_audit_col_query')}
              </p>
              <p className="text-text-primary text-sm break-words whitespace-pre-wrap">
                {pair?.query ?? ''}
              </p>
            </div>
            <div>
              <p className="text-text-secondary mb-1 text-xs font-semibold tracking-wide uppercase">
                {localize('com_ui_tars_audit_col_response')}
              </p>
              <div className="prose dark:prose-invert text-text-primary max-w-none text-sm">
                <MarkdownLite content={pair?.response ?? ''} codeExecution={false} />
              </div>
            </div>
          </div>
        }
      />
    </OGDialog>
  );
}
