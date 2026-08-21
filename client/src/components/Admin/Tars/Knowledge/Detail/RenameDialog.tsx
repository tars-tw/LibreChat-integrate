import { useState } from 'react';
import {
  Button,
  Input,
  Label,
  OGDialog,
  OGDialogTemplate,
  Spinner,
  useToastContext,
} from '@librechat/client';
import type { TTarsDocument } from 'librechat-data-provider';
import { useRenameTarsDocumentMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';

/** Renames one document. pwc_tars keeps the extension, so only the stem matters. */
export default function RenameDialog({
  knowledgeBaseId,
  document,
  onClose,
}: {
  knowledgeBaseId: string;
  document: TTarsDocument;
  onClose: () => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [name, setName] = useState(document.filename);

  const renameMutation = useRenameTarsDocumentMutation(knowledgeBaseId, {
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_kb_ds_renamed'), status: 'success' });
      onClose();
    },
    onError: () => showToast({ message: localize('com_ui_tars_admin_error'), status: 'error' }),
  });

  const trimmed = name.trim();
  const canSave = trimmed !== '' && trimmed !== document.filename && !renameMutation.isLoading;

  return (
    <OGDialog open={true} onOpenChange={(open) => !open && onClose()}>
      <OGDialogTemplate
        title={localize('com_ui_rename')}
        className="w-11/12 max-w-md"
        showCloseButton={true}
        main={
          <div className="space-y-1.5">
            <Label htmlFor="tars-doc-rename">{localize('com_ui_tars_kb_ds_name')}</Label>
            <Input
              id="tars-doc-rename"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && canSave) {
                  renameMutation.mutate({ docId: document.id, newFilename: trimmed });
                }
              }}
            />
          </div>
        }
        buttons={
          <Button
            variant="submit"
            disabled={!canSave}
            onClick={() => renameMutation.mutate({ docId: document.id, newFilename: trimmed })}
          >
            {renameMutation.isLoading ? <Spinner className="size-4" /> : localize('com_ui_save')}
          </Button>
        }
      />
    </OGDialog>
  );
}
