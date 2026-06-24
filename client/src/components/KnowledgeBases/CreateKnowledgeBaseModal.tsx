import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import {
  Button,
  Label,
  Input,
  Spinner,
  OGDialog,
  OGDialogTemplate,
  useToastContext,
} from '@librechat/client';
import { useTarsModelOptionsQuery, useUploadTarsKnowledgeBaseMutation } from '~/data-provider';
import { useLocalize } from '~/hooks';

const selectClass =
  'w-full rounded-lg border border-border-light bg-transparent px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-heavy';

const emptyForm = {
  name: '',
  description: '',
  llmModel: '',
  embeddingModel: '',
  rerankModel: '',
  maxRetrieve: 20,
};

export default function CreateKnowledgeBaseModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { data: models } = useTarsModelOptionsQuery({ enabled: open });
  const [form, setForm] = useState(emptyForm);
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);

  const reset = () => {
    setForm(emptyForm);
    setFile(null);
  };

  const createMutation = useUploadTarsKnowledgeBaseMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_kb_saved'), status: 'success' });
      reset();
      onOpenChange(false);
    },
    onError: () => showToast({ message: localize('com_ui_tars_admin_error'), status: 'error' }),
  });

  const handleSubmit = () => {
    if (!form.name.trim() || !form.llmModel) {
      showToast({ message: localize('com_ui_tars_kb_create_required'), status: 'error' });
      return;
    }
    const data = new FormData();
    data.append('knowledgeName', form.name.trim());
    data.append('description', form.description.trim());
    data.append('llmModel', form.llmModel);
    if (form.embeddingModel) {
      data.append('embeddingModel', form.embeddingModel);
    }
    if (form.rerankModel) {
      data.append('rerankModel', form.rerankModel);
    }
    data.append('maxRetrieveCount', String(form.maxRetrieve));
    if (file) {
      data.append('file', file);
    }
    createMutation.mutate(data);
  };

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogTemplate
        title={localize('com_ui_tars_kb_new')}
        showCloseButton={true}
        className="w-11/12 md:max-w-xl"
        main={
          <div className="space-y-4">
            <div>
              <Label htmlFor="kb-create-name">{localize('com_ui_name')}</Label>
              <Input
                id="kb-create-name"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor="kb-create-desc">{localize('com_ui_description')}</Label>
              <textarea
                id="kb-create-desc"
                rows={2}
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                className="min-h-[56px] w-full resize-none rounded-lg border border-border-light bg-transparent px-3 py-2 text-sm text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-heavy"
              />
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div>
                <Label htmlFor="kb-create-llm">{localize('com_ui_tars_kb_llm_model')}</Label>
                <select
                  id="kb-create-llm"
                  className={selectClass}
                  value={form.llmModel}
                  onChange={(e) => setForm((p) => ({ ...p, llmModel: e.target.value }))}
                >
                  <option value="">—</option>
                  {models?.llm.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="kb-create-embed">
                  {localize('com_ui_tars_kb_embedding_model')}
                </Label>
                <select
                  id="kb-create-embed"
                  className={selectClass}
                  value={form.embeddingModel}
                  onChange={(e) => setForm((p) => ({ ...p, embeddingModel: e.target.value }))}
                >
                  <option value="">—</option>
                  {models?.embedding.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="kb-create-rerank">{localize('com_ui_tars_kb_rerank_model')}</Label>
                <select
                  id="kb-create-rerank"
                  className={selectClass}
                  value={form.rerankModel}
                  onChange={(e) => setForm((p) => ({ ...p, rerankModel: e.target.value }))}
                >
                  <option value="">—</option>
                  {models?.rerank.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <Label htmlFor="kb-create-retrieve">{localize('com_ui_tars_kb_max_retrieve')}</Label>
              <Input
                id="kb-create-retrieve"
                type="number"
                value={form.maxRetrieve}
                onChange={(e) => setForm((p) => ({ ...p, maxRetrieve: Number(e.target.value) }))}
              />
            </div>
            <div>
              <Label>{localize('com_ui_tars_kb_seed_file')}</Label>
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => fileRef.current?.click()}
                  className="gap-1"
                >
                  <Upload className="icon-sm" /> {localize('com_ui_tars_kb_choose_file')}
                </Button>
                <span className="truncate text-sm text-text-secondary">
                  {file?.name ?? localize('com_ui_none')}
                </span>
              </div>
            </div>
          </div>
        }
        buttons={
          <Button variant="submit" onClick={handleSubmit} disabled={createMutation.isLoading}>
            {createMutation.isLoading ? <Spinner /> : localize('com_ui_create')}
          </Button>
        }
      />
    </OGDialog>
  );
}
