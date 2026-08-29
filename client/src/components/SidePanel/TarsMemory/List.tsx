import { useState, useCallback } from 'react';
import { Eye, Table2, Download } from 'lucide-react';
import { dataService } from 'librechat-data-provider';
import {
  Switch,
  Spinner,
  OGDialog,
  TrashIcon,
  useToastContext,
  OGDialogTrigger,
  OGDialogTemplate,
} from '@librechat/client';
import type { TTarsMemoryDocument } from 'librechat-data-provider';
import {
  useTarsMemoryQuery,
  useTarsMemoryStatusMutation,
  useDeleteTarsMemoryDocumentMutation,
} from '~/data-provider/Tars';
import { useChatContext } from '~/Providers';
import PreviewDialog from './PreviewDialog';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const formatSize = (bytes: number | null): string => {
  if (bytes == null || bytes <= 0) {
    return '';
  }
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

function MemoryRow({
  document,
  tarsConversationId,
  onPreview,
}: {
  document: TTarsMemoryDocument;
  tarsConversationId: string;
  onPreview: (document: TTarsMemoryDocument) => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const statusMutation = useTarsMemoryStatusMutation(tarsConversationId);
  const deleteMutation = useDeleteTarsMemoryDocumentMutation(tarsConversationId);

  const handleDownload = useCallback(async () => {
    try {
      const response = await dataService.getTarsMemoryDocumentDownload(document.id);
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = window.document.createElement('a');
      link.href = url;
      link.download = document.filename;
      link.click();
      window.URL.revokeObjectURL(url);
    } catch {
      showToast({ status: 'error', message: localize('com_ui_download_error') });
    }
  }, [document.id, document.filename, localize, showToast]);

  return (
    <div className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-surface-secondary">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          {document.structured && (
            <Table2
              className="icon-sm shrink-0 text-text-secondary"
              aria-label={localize('com_ui_tars_memory_structured')}
            />
          )}
          <span className="truncate text-sm text-text-primary" title={document.filename}>
            {document.filename}
          </span>
        </div>
        <span className="text-xs text-text-secondary">
          {[formatSize(document.size), document.tokens != null ? `${document.tokens} tokens` : '']
            .filter(Boolean)
            .join(' · ')}
        </span>
      </div>
      <button
        type="button"
        className="rounded p-1 text-text-secondary hover:text-text-primary"
        aria-label={localize('com_ui_preview')}
        onClick={() => onPreview(document)}
      >
        <Eye className="icon-sm" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="rounded p-1 text-text-secondary hover:text-text-primary"
        aria-label={localize('com_ui_download')}
        onClick={handleDownload}
      >
        <Download className="icon-sm" aria-hidden="true" />
      </button>
      <OGDialog>
        <OGDialogTrigger asChild>
          <button
            type="button"
            className="rounded p-1 text-text-secondary hover:text-text-primary"
            aria-label={localize('com_ui_delete')}
          >
            {deleteMutation.isLoading ? (
              <Spinner className="icon-sm" aria-hidden="true" />
            ) : (
              <TrashIcon className="icon-sm" aria-hidden="true" />
            )}
          </button>
        </OGDialogTrigger>
        <OGDialogTemplate
          showCloseButton={false}
          title={localize('com_ui_delete')}
          className="max-w-[450px]"
          main={
            <div className="text-sm text-text-primary">
              {localize('com_ui_tars_memory_delete_confirm', { 0: document.filename })}
            </div>
          }
          selection={{
            selectHandler: () => deleteMutation.mutate(document.id),
            selectClasses:
              'bg-red-700 dark:bg-red-600 hover:bg-red-800 dark:hover:bg-red-800 text-white',
            selectText: localize('com_ui_delete'),
          }}
        />
      </OGDialog>
      <Switch
        checked={document.status === 1}
        onCheckedChange={(checked) =>
          statusMutation.mutate({ documentId: document.id, status: checked ? 1 : 0 })
        }
        disabled={statusMutation.isLoading}
        aria-label={localize('com_ui_tars_memory_include')}
      />
    </div>
  );
}

/**
 * The current conversation's long-term memory documents: include-in-chat
 * toggle, parsed-text preview, original-file download, delete, and the token
 * usage bar. Shared by the side panel and the memory dialog's uploaded tab.
 */
export default function TarsMemoryList() {
  const localize = useLocalize();
  const { conversation } = useChatContext();
  const [previewDocument, setPreviewDocument] = useState<TTarsMemoryDocument | null>(null);

  const tarsConversationId = conversation?.tarsConversationId ?? null;
  const { data, isLoading, isError } = useTarsMemoryQuery(tarsConversationId);

  const documents = data?.documents ?? [];
  const tokenUsed = data?.token_used ?? 0;
  const tokenLimit = data?.token_limit ?? 0;
  const usageRatio = tokenLimit > 0 ? Math.min(1, tokenUsed / tokenLimit) : 0;

  const renderBody = () => {
    if (tarsConversationId == null) {
      return (
        <p className="px-1 text-sm text-text-secondary">
          {localize('com_ui_tars_memory_empty_new_chat')}
        </p>
      );
    }
    if (isLoading) {
      return (
        <div className="flex items-center justify-center p-6">
          <Spinner className="icon-md" aria-hidden="true" />
        </div>
      );
    }
    if (isError) {
      return (
        <p className="px-1 text-sm text-text-secondary">{localize('com_ui_tars_memory_error')}</p>
      );
    }
    return (
      <>
        {documents.length === 0 ? (
          <p className="px-1 text-sm text-text-secondary">{localize('com_ui_tars_memory_empty')}</p>
        ) : (
          <div role="list" aria-label={localize('com_ui_tars_memory')}>
            {documents.map((document) => (
              <MemoryRow
                key={document.id}
                document={document}
                tarsConversationId={tarsConversationId}
                onPreview={setPreviewDocument}
              />
            ))}
          </div>
        )}
        {tokenLimit > 0 && (
          <div className="px-1">
            <div className="mb-1 flex justify-between text-xs text-text-secondary">
              <span>{localize('com_ui_tars_memory_tokens')}</span>
              <span>
                {tokenUsed} / {tokenLimit}
              </span>
            </div>
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-surface-tertiary"
              role="progressbar"
              aria-valuenow={tokenUsed}
              aria-valuemin={0}
              aria-valuemax={tokenLimit}
            >
              <div
                className={cn(
                  'h-full rounded-full bg-text-secondary',
                  usageRatio >= 0.9 && 'bg-red-500',
                )}
                style={{ width: `${Math.round(usageRatio * 100)}%` }}
              />
            </div>
          </div>
        )}
      </>
    );
  };

  return (
    <div className="space-y-3">
      {renderBody()}
      <PreviewDialog
        document={previewDocument}
        onOpenChange={(open) => {
          if (!open) {
            setPreviewDocument(null);
          }
        }}
      />
    </div>
  );
}
