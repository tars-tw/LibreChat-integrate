import { Spinner, OGDialog, OGDialogTemplate } from '@librechat/client';
import type { TTarsMemoryDocument } from 'librechat-data-provider';
import { useTarsMemoryDocumentContentQuery } from '~/data-provider/Tars';
import { useLocalize } from '~/hooks';

/**
 * Preview of a memory document's parsed content: the text pwc_tars extracted
 * at upload (`summary`), which is exactly what the model reads each turn.
 */
export default function PreviewDialog({
  document,
  onOpenChange,
}: {
  document: TTarsMemoryDocument | null;
  onOpenChange: (open: boolean) => void;
}) {
  const localize = useLocalize();
  const { data: content, isLoading } = useTarsMemoryDocumentContentQuery(document?.id);

  return (
    <OGDialog open={document != null} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        title={document?.filename ?? ''}
        className="max-w-2xl"
        showCloseButton={true}
        main={
          <div className="max-h-[60vh] overflow-y-auto rounded-lg bg-surface-secondary p-3">
            {isLoading ? (
              <div className="flex items-center justify-center p-6">
                <Spinner className="icon-md" aria-hidden="true" />
              </div>
            ) : (
              <pre className="whitespace-pre-wrap break-words text-sm text-text-primary">
                {content?.content || localize('com_ui_tars_memory_no_content')}
              </pre>
            )}
          </div>
        }
      />
    </OGDialog>
  );
}
