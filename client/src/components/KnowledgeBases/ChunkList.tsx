import { useState } from 'react';
import { Pencil, Trash2, Check, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Spinner, OGDialog, OGDialogTemplate, useToastContext } from '@librechat/client';
import type { TTarsDocument } from 'librechat-data-provider';
import {
  useTarsDocumentChunksQuery,
  useUpdateTarsChunkMutation,
  useDeleteTarsChunkMutation,
} from '~/data-provider';
import { useLocalize } from '~/hooks';

export default function ChunkList({
  document,
  open,
  onOpenChange,
}: {
  document: TTarsDocument;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { data: chunks = [], isLoading } = useTarsDocumentChunksQuery(open ? document.id : null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const onError = () =>
    showToast({ message: localize('com_ui_tars_admin_error'), status: 'error' });

  const updateMutation = useUpdateTarsChunkMutation(document.id, {
    onSuccess: () => {
      showToast({ message: localize('com_ui_saved'), status: 'success' });
      setEditingId(null);
    },
    onError,
  });
  const deleteMutation = useDeleteTarsChunkMutation(document.id, {
    onSuccess: () => showToast({ message: localize('com_ui_deleted'), status: 'success' }),
    onError,
  });

  let body: ReactNode;
  if (isLoading) {
    body = (
      <div className="flex h-40 items-center justify-center">
        <Spinner />
      </div>
    );
  } else if (chunks.length === 0) {
    body = (
      <p className="py-8 text-center text-sm text-text-secondary">{localize('com_ui_none')}</p>
    );
  } else {
    body = (
      <div className="max-h-[60vh] space-y-2 overflow-y-auto">
        {chunks.map((chunk) => {
          const isEditing = editingId === chunk.id;
          return (
            <div key={chunk.id} className="rounded-lg border border-border-light p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs text-text-secondary">
                  {localize('com_ui_tars_kb_chunk_meta', {
                    position: chunk.position,
                    tokens: chunk.tokens ?? 0,
                    hits: chunk.hit_count ?? 0,
                  })}
                </span>
                <div className="flex items-center gap-1">
                  {isEditing ? (
                    <>
                      <button
                        type="button"
                        aria-label={localize('com_ui_save')}
                        onClick={() =>
                          updateMutation.mutate({
                            chunkId: chunk.id,
                            data: { content: draft },
                          })
                        }
                        className="rounded p-1.5 text-green-600 hover:bg-surface-hover"
                      >
                        <Check className="icon-sm" />
                      </button>
                      <button
                        type="button"
                        aria-label={localize('com_ui_cancel')}
                        onClick={() => setEditingId(null)}
                        className="rounded p-1.5 text-text-secondary hover:bg-surface-hover"
                      >
                        <X className="icon-sm" />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        aria-label={localize('com_ui_edit')}
                        onClick={() => {
                          setEditingId(chunk.id);
                          setDraft(chunk.content);
                        }}
                        className="rounded p-1.5 hover:bg-surface-hover"
                      >
                        <Pencil className="icon-sm" />
                      </button>
                      <button
                        type="button"
                        aria-label={localize('com_ui_delete')}
                        onClick={() => {
                          if (window.confirm(localize('com_ui_tars_kb_chunk_delete_confirm'))) {
                            deleteMutation.mutate(chunk.id);
                          }
                        }}
                        className="rounded p-1.5 text-red-500 hover:bg-surface-hover"
                      >
                        <Trash2 className="icon-sm" />
                      </button>
                    </>
                  )}
                </div>
              </div>
              {isEditing ? (
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={5}
                  className="w-full resize-y rounded-lg border border-border-light bg-transparent px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-heavy"
                />
              ) : (
                <p className="whitespace-pre-wrap text-sm text-text-primary">{chunk.content}</p>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        title={localize('com_ui_tars_kb_chunks_of', { name: document.filename })}
        showCloseButton={true}
        className="w-11/12 md:max-w-3xl"
        main={body}
      />
    </OGDialog>
  );
}
