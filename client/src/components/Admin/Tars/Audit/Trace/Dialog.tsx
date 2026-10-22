import { Download } from 'lucide';
import { Activity, FileSearch } from 'lucide-react';
import {
  Alert,
  Spinner,
  OGDialog,
  EmptyState,
  OGDialogTitle,
  OGDialogContent,
  useToastContext,
} from '@librechat/client';
import {
  DialogBar,
  ScrollBox,
  DialogFrame,
  ErrorDetails,
  TraceErrorAlert,
  TraceErrorBoundary,
  TraceMessageContext,
} from './Parts';
import ActionButton from '~/components/Messages/Content/ActionButton';
import CopyButton from '~/components/Messages/Content/CopyButton';
import { useTarsAuditMessageTraceQuery } from '~/data-provider';
import { downloadBlob } from '../../Users/helpers';
import { buildTraceDownloadText } from './report';
import { summarizeTrace } from './summary';
import { traceErrorInfo } from './errors';
import { useCopyFeedback } from './copy';
import { useLocalize } from '~/hooks';
import TraceView from './View';

/**
 * The 執行明細 dialog for one audited message. It mounts only while open, and
 * the query keeps no cache, so every opening fetches the latest trace.
 */
export default function TraceDialog({
  messageId,
  onClose,
}: {
  messageId: string;
  onClose: () => void;
}) {
  const localize = useLocalize();
  return (
    <OGDialog open onOpenChange={(open) => !open && onClose()}>
      <OGDialogContent className="flex max-h-[90vh] w-11/12 max-w-7xl flex-col overflow-hidden">
        {/* The report page is this dialog's parent: a crash anywhere in the panel stays here, closable. */}
        <TraceErrorBoundary
          title={localize('com_ui_tars_audit_trace_view_error')}
          fallback={(error) => (
            <div className="pr-8">
              {/* The dialog still needs its accessible name once the header is gone. */}
              <OGDialogTitle className="sr-only">
                {localize('com_ui_tars_audit_trace_dialog_title')}
              </OGDialogTitle>
              <Alert variant="warning" role="alert">
                <div className="text-xs">
                  <p className="font-medium">{localize('com_ui_tars_audit_trace_view_error')}</p>
                  <p className="text-text-secondary mt-1">
                    {localize('com_ui_tars_audit_trace_err_render_hint')}
                  </p>
                  <ErrorDetails details={`${messageId} · ${error.message}`} />
                </div>
              </Alert>
            </div>
          )}
        >
          <TraceDialogPanel messageId={messageId} />
        </TraceErrorBoundary>
      </OGDialogContent>
    </OGDialog>
  );
}

/** The header and body; a child of the dialog's boundary, so anything it throws is caught there. */
function TraceDialogPanel({ messageId }: { messageId: string }) {
  const localize = useLocalize();
  const query = useTarsAuditMessageTraceQuery(messageId);
  const { showToast } = useToastContext();
  const messageIdCopy = useCopyFeedback();
  const conversationIdCopy = useCopyFeedback();
  const message = query.data?.message;

  /** A trace the report cannot be built from is announced: a silent failure looks like a dead button. */
  const handleDownload = () => {
    if (!query.data) {
      return;
    }
    try {
      const text = buildTraceDownloadText(localize, summarizeTrace(query.data));
      downloadBlob(
        new Blob([text], { type: 'text/plain;charset=utf-8' }),
        `trace_${query.data.message.id || 'unknown'}.txt`,
      );
    } catch (error) {
      console.error('[TraceDialog] Could not build the trace report', error);
      showToast({ message: localize('com_ui_tars_audit_trace_download_failed'), status: 'error' });
    }
  };

  const renderBody = () => {
    if (query.isLoading) {
      return (
        <div className="text-text-secondary flex justify-center py-6" role="status">
          <Spinner className="size-5" />
          <span className="sr-only">{localize('com_ui_tars_audit_trace_loading')}</span>
        </div>
      );
    }
    /** A gone message is an answer, not a failure; anything else says why and what to do. */
    if (query.isError) {
      const info = traceErrorInfo(query.error);
      return info.kind === 'message_not_found' ? (
        <EmptyState icon={FileSearch} description={localize('com_ui_tars_audit_trace_not_found')} />
      ) : (
        <TraceErrorAlert info={info} context={messageId} onRetry={() => query.refetch()} />
      );
    }
    if (!query.data?.trace.length) {
      return (
        <EmptyState icon={FileSearch} description={localize('com_ui_tars_audit_trace_no_data')} />
      );
    }
    /** TraceView summarizes the trace before its own boundary renders; this one catches that. */
    return (
      <TraceErrorBoundary
        title={localize('com_ui_tars_audit_trace_view_error')}
        hint={localize('com_ui_tars_audit_trace_err_render_hint')}
        resetKey={query.data}
      >
        <TraceMessageContext.Provider value={query.data.message.id}>
          <TraceView data={query.data} />
        </TraceMessageContext.Provider>
      </TraceErrorBoundary>
    );
  };

  return (
    <DialogFrame>
      <DialogBar>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="bg-surface-tertiary text-text-secondary flex size-7 shrink-0 items-center justify-center rounded-lg">
              <Activity className="size-4" aria-hidden="true" />
            </div>
            <OGDialogTitle>{localize('com_ui_tars_audit_trace_dialog_title')}</OGDialogTitle>
          </div>
          <div className="flex items-center gap-1.5">
            {message?.id ? (
              <CopyButton
                isCopied={messageIdCopy.isCopied}
                onClick={() => messageIdCopy.copyText(message.id)}
                label={localize('com_ui_tars_audit_trace_copy_message_id')}
                className="ml-0 text-xs font-medium"
              />
            ) : null}
            {message?.conversation_id ? (
              <CopyButton
                isCopied={conversationIdCopy.isCopied}
                onClick={() => conversationIdCopy.copyText(message.conversation_id)}
                label={localize('com_ui_tars_audit_trace_copy_conversation_id')}
                className="ml-0 text-xs font-medium"
              />
            ) : null}
            {query.data?.trace.length ? (
              <ActionButton
                icon={Download}
                isActive={false}
                label={localize('com_ui_tars_audit_trace_download_trace')}
                activeLabel={localize('com_ui_tars_audit_trace_download_trace')}
                onClick={handleDownload}
                className="ml-0 text-xs font-medium"
              />
            ) : null}
          </div>
        </div>
      </DialogBar>
      <ScrollBox
        content={query.data}
        className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6 sm:py-5"
      >
        {renderBody()}
      </ScrollBox>
    </DialogFrame>
  );
}
