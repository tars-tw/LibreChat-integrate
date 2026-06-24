import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Pencil, Trash2, RefreshCw, FileText, Layers } from 'lucide-react';
import { Button, Spinner, useToastContext } from '@librechat/client';
import type { TTarsDocument } from 'librechat-data-provider';
import {
  useTarsKnowledgeBasesQuery,
  useTarsKnowledgeBaseDocumentsQuery,
  useRenameTarsDocumentMutation,
  useDeleteTarsDocumentMutation,
  useReprocessTarsDocumentMutation,
} from '~/data-provider';
import { useLocalize, useIsTarsAdmin } from '~/hooks';
import UploadDocumentsModal from './UploadDocumentsModal';
import EditKnowledgeBaseModal from './EditKnowledgeBaseModal';
import { getDocStatusMeta } from './status';
import ChunkList from './ChunkList';

export default function KnowledgeBaseDetail() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const isTarsAdmin = useIsTarsAdmin();
  const { kbId = '' } = useParams();
  const { showToast } = useToastContext();

  const { data: knowledgeBases = [] } = useTarsKnowledgeBasesQuery();
  const knowledgeBase = useMemo(
    () => knowledgeBases.find((kb) => kb.id === kbId),
    [knowledgeBases, kbId],
  );
  const { data: documents = [], isLoading } = useTarsKnowledgeBaseDocumentsQuery(kbId);

  const [showUpload, setShowUpload] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [chunkDoc, setChunkDoc] = useState<TTarsDocument | null>(null);

  const onError = () =>
    showToast({ message: localize('com_ui_tars_admin_error'), status: 'error' });

  const renameMutation = useRenameTarsDocumentMutation(kbId, {
    onSuccess: () => showToast({ message: localize('com_ui_saved'), status: 'success' }),
    onError,
  });
  const deleteMutation = useDeleteTarsDocumentMutation(kbId, {
    onSuccess: () => showToast({ message: localize('com_ui_deleted'), status: 'success' }),
    onError,
  });
  const reprocessMutation = useReprocessTarsDocumentMutation(kbId, {
    onSuccess: () =>
      showToast({ message: localize('com_ui_tars_kb_reprocess_started'), status: 'success' }),
    onError,
  });

  if (!isTarsAdmin) {
    navigate('/c/new', { replace: true });
    return null;
  }

  const handleRename = (doc: TTarsDocument) => {
    const next = window.prompt(localize('com_ui_tars_kb_rename_prompt'), doc.filename);
    if (next && next.trim() && next.trim() !== doc.filename) {
      renameMutation.mutate({ docId: doc.id, newFilename: next.trim() });
    }
  };

  return (
    <div className="h-full w-full overflow-y-auto bg-presentation">
      <div className="mx-auto max-w-5xl space-y-6 p-6">
        <button
          type="button"
          onClick={() => navigate('/knowledge-bases')}
          className="flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary"
        >
          <ArrowLeft className="icon-sm" /> {localize('com_ui_back')}
        </button>

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold text-text-primary">
              {knowledgeBase?.name ?? localize('com_ui_tars_knowledge_bases')}
            </h1>
            {knowledgeBase?.description && (
              <p className="mt-1 text-sm text-text-secondary">{knowledgeBase.description}</p>
            )}
            {knowledgeBase && (
              <div className="mt-3 flex flex-wrap gap-4 text-sm text-text-secondary">
                <span className="flex items-center gap-1">
                  <FileText className="icon-sm" />
                  {localize('com_ui_tars_kb_doc_count', {
                    count: knowledgeBase.document_count ?? 0,
                  })}
                </span>
                <span className="flex items-center gap-1">
                  <Layers className="icon-sm" />
                  {localize('com_ui_tars_kb_chunk_count', {
                    count: knowledgeBase.total_chunk_count ?? 0,
                  })}
                </span>
                <span>
                  {localize('com_ui_tars_kb_token_count', {
                    count: knowledgeBase.total_token_count ?? 0,
                  })}
                </span>
                {knowledgeBase.llm_model && (
                  <span>
                    {localize('com_ui_tars_kb_llm_model')}: {knowledgeBase.llm_model}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex flex-shrink-0 gap-2">
            {knowledgeBase && (
              <Button variant="outline" onClick={() => setShowEdit(true)} className="gap-1">
                <Pencil className="icon-sm" /> {localize('com_ui_edit')}
              </Button>
            )}
            <Button variant="submit" onClick={() => setShowUpload(true)} className="gap-1">
              <Plus className="icon-sm" /> {localize('com_ui_tars_kb_upload_documents')}
            </Button>
          </div>
        </div>

        {isLoading && (
          <div className="flex h-40 items-center justify-center">
            <Spinner />
          </div>
        )}
        {!isLoading && documents.length === 0 && (
          <p className="py-12 text-center text-sm text-text-secondary">
            {localize('com_ui_tars_kb_no_documents')}
          </p>
        )}
        {!isLoading && documents.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-border-light">
            <table className="w-full text-sm">
              <thead className="bg-surface-secondary text-left text-text-secondary">
                <tr>
                  <th className="px-4 py-2 font-medium">{localize('com_ui_name')}</th>
                  <th className="px-4 py-2 font-medium">{localize('com_ui_tars_kb_status')}</th>
                  <th className="px-4 py-2 font-medium">{localize('com_ui_tars_kb_tokens')}</th>
                  <th className="px-4 py-2 text-right font-medium">{localize('com_ui_actions')}</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => {
                  const status = getDocStatusMeta(doc.status);
                  return (
                    <tr key={doc.id} className="border-t border-border-light">
                      <td className="max-w-0 px-4 py-2">
                        <span className="block truncate text-text-primary">{doc.filename}</span>
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`inline-block rounded px-1.5 py-0.5 text-xs ${status.className}`}
                        >
                          {localize(status.labelKey)}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-text-secondary">{doc.tokens ?? 0}</td>
                      <td className="px-4 py-2">
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            aria-label={localize('com_ui_tars_kb_view_chunks')}
                            onClick={() => setChunkDoc(doc)}
                            className="rounded p-1.5 hover:bg-surface-hover"
                          >
                            <Layers className="icon-sm" />
                          </button>
                          <button
                            type="button"
                            aria-label={localize('com_ui_tars_kb_reprocess')}
                            onClick={() => {
                              if (window.confirm(localize('com_ui_tars_kb_reprocess_confirm'))) {
                                reprocessMutation.mutate({ docId: doc.id, data: {} });
                              }
                            }}
                            className="rounded p-1.5 hover:bg-surface-hover"
                          >
                            <RefreshCw className="icon-sm" />
                          </button>
                          <button
                            type="button"
                            aria-label={localize('com_ui_edit')}
                            onClick={() => handleRename(doc)}
                            className="rounded p-1.5 hover:bg-surface-hover"
                          >
                            <Pencil className="icon-sm" />
                          </button>
                          <button
                            type="button"
                            aria-label={localize('com_ui_delete')}
                            onClick={() => {
                              if (window.confirm(localize('com_ui_tars_kb_doc_delete_confirm'))) {
                                deleteMutation.mutate(doc.id);
                              }
                            }}
                            className="rounded p-1.5 text-red-500 hover:bg-surface-hover"
                          >
                            <Trash2 className="icon-sm" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showUpload && (
        <UploadDocumentsModal
          knowledgeBaseId={kbId}
          open={showUpload}
          onOpenChange={setShowUpload}
        />
      )}
      {showEdit && knowledgeBase && (
        <EditKnowledgeBaseModal
          knowledgeBase={knowledgeBase}
          open={showEdit}
          onOpenChange={setShowEdit}
        />
      )}
      {chunkDoc && (
        <ChunkList
          document={chunkDoc}
          open={chunkDoc != null}
          onOpenChange={(open) => !open && setChunkDoc(null)}
        />
      )}
    </div>
  );
}
