import { useState } from 'react';
import {
  Button,
  Label,
  Input,
  Spinner,
  OGDialog,
  OGDialogTemplate,
  useToastContext,
} from '@librechat/client';
import type { TTarsKnowledgeBase } from 'librechat-data-provider';
import { useUpdateTarsKnowledgeBaseMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';

export default function EditKnowledgeBaseModal({
  knowledgeBase,
  open,
  onOpenChange,
}: {
  knowledgeBase: TTarsKnowledgeBase;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [form, setForm] = useState({
    name: knowledgeBase.name,
    description: knowledgeBase.description ?? '',
    maxRetrieve: knowledgeBase.max_retrieve_count ?? 20,
  });

  const updateMutation = useUpdateTarsKnowledgeBaseMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_kb_saved'), status: 'success' });
      onOpenChange(false);
    },
    onError: () => showToast({ message: localize('com_ui_tars_admin_error'), status: 'error' }),
  });

  const handleSave = () => {
    if (!form.name.trim()) {
      showToast({ message: localize('com_ui_tars_kb_create_required'), status: 'error' });
      return;
    }
    updateMutation.mutate({
      id: knowledgeBase.id,
      data: {
        name: form.name.trim(),
        description: form.description.trim(),
        new_max_retrieve_count: Number(form.maxRetrieve),
      },
    });
  };

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        title={localize('com_ui_tars_kb_edit')}
        showCloseButton={true}
        className="w-11/12 md:max-w-lg"
        main={
          <div className="space-y-4">
            <div>
              <Label htmlFor="kb-edit-name">{localize('com_ui_name')}</Label>
              <Input
                id="kb-edit-name"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="kb-edit-desc">{localize('com_ui_description')}</Label>
              <textarea
                id="kb-edit-desc"
                rows={3}
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                className="min-h-[72px] w-full resize-none rounded-lg border border-border-light bg-transparent px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-heavy"
              />
            </div>
            <div>
              <Label htmlFor="kb-edit-retrieve">{localize('com_ui_tars_kb_max_retrieve')}</Label>
              <Input
                id="kb-edit-retrieve"
                type="number"
                value={form.maxRetrieve}
                onChange={(e) => setForm((p) => ({ ...p, maxRetrieve: Number(e.target.value) }))}
              />
            </div>
          </div>
        }
        buttons={
          <Button variant="submit" onClick={handleSave} disabled={updateMutation.isLoading}>
            {updateMutation.isLoading ? <Spinner /> : localize('com_ui_save')}
          </Button>
        }
      />
    </OGDialog>
  );
}
