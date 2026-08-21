import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Dropdown,
  Input,
  Label,
  OGDialog,
  OGDialogTemplate,
  Spinner,
  useToastContext,
} from '@librechat/client';
import type { TTarsKnowledgeBase, TTarsKnowledgeBaseUser } from 'librechat-data-provider';
import type { TTarsKnowledgeBaseGroup } from 'librechat-data-provider';
import {
  useTarsModelOptionsQuery,
  useUpdateTarsKnowledgeBaseMutation,
  useUploadTarsKnowledgeBaseMutation,
} from '~/data-provider';
import { DEFAULT_MAX_RETRIEVE, groupPickerOptions, userPickerOptions } from './helpers';
import { useLocalize } from '~/hooks';
import Picker from '../Audit/Picker';

const NAME_MIN = 2;
const NAME_MAX = 40;
const RETRIEVE_MIN = 1;
const RETRIEVE_MAX = 100;

interface FormState {
  name: string;
  description: string;
  tags: string;
  maxRetrieveCount: string;
  llmModel: string;
  embeddingModel: string;
  rerankModel: string;
  allowedUserIds: string[];
  allowedUserGroupIds: string[];
}

const emptyForm: FormState = {
  name: '',
  description: '',
  tags: '',
  maxRetrieveCount: String(DEFAULT_MAX_RETRIEVE),
  llmModel: '',
  embeddingModel: '',
  rerankModel: '',
  allowedUserIds: [],
  allowedUserGroupIds: [],
};

/**
 * Create or edit a knowledge base.
 *
 * Creating goes through pwc_tars' multipart `create_knowledge_base_with_file`
 * even with no file attached: that is the only endpoint that also writes the
 * `sys_rag_model` row a base needs before it can answer anything.
 *
 * Editing is a different, narrower endpoint, so the model pickers are shown
 * only when creating — an existing base rebinds its models from the batch
 * dialog, which is what pwc_tars' own page does.
 */
export default function KnowledgeModal({
  knowledgeBase,
  users,
  groups,
  onClose,
}: {
  /** `null` opens the create form. */
  knowledgeBase: TTarsKnowledgeBase | null;
  users: TTarsKnowledgeBaseUser[];
  groups: TTarsKnowledgeBaseGroup[];
  onClose: () => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const isEdit = knowledgeBase != null;

  const [form, setForm] = useState<FormState>(emptyForm);
  const [file, setFile] = useState<File | null>(null);

  const modelsQuery = useTarsModelOptionsQuery({ enabled: !isEdit });

  const userOptions = useMemo(() => userPickerOptions(users), [users]);
  const groupOptions = useMemo(() => groupPickerOptions(groups), [groups]);

  useEffect(() => {
    if (knowledgeBase == null) {
      setForm(emptyForm);
      setFile(null);
      return;
    }
    setForm({
      ...emptyForm,
      name: knowledgeBase.name,
      description: knowledgeBase.description ?? '',
      maxRetrieveCount: String(knowledgeBase.max_retrieve_count ?? DEFAULT_MAX_RETRIEVE),
      allowedUserIds: knowledgeBase.allowed_user_ids ?? [],
      allowedUserGroupIds: knowledgeBase.allowed_user_group_ids ?? [],
    });
  }, [knowledgeBase]);

  /** Default each model picker to pwc_tars' first option, as the original does. */
  useEffect(() => {
    const models = modelsQuery.data;
    if (models == null) {
      return;
    }
    setForm((prev) => ({
      ...prev,
      llmModel: prev.llmModel !== '' ? prev.llmModel : (models.llm[0]?.id ?? ''),
      embeddingModel:
        prev.embeddingModel !== '' ? prev.embeddingModel : (models.embedding[0]?.id ?? ''),
      rerankModel: prev.rerankModel !== '' ? prev.rerankModel : (models.rerank[0]?.id ?? ''),
    }));
  }, [modelsQuery.data]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const uploadMutation = useUploadTarsKnowledgeBaseMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_kb_saved'), status: 'success' });
      onClose();
    },
    onError: () => showToast({ message: localize('com_ui_tars_kb_save_failed'), status: 'error' }),
  });

  const updateMutation = useUpdateTarsKnowledgeBaseMutation({
    onSuccess: () => {
      showToast({ message: localize('com_ui_tars_kb_saved'), status: 'success' });
      onClose();
    },
    onError: () => showToast({ message: localize('com_ui_tars_kb_save_failed'), status: 'error' }),
  });

  const trimmedName = form.name.trim();
  const retrieveCount = Number(form.maxRetrieveCount);
  const nameInvalid = trimmedName.length < NAME_MIN || trimmedName.length > NAME_MAX;
  const retrieveInvalid =
    !Number.isInteger(retrieveCount) ||
    retrieveCount < RETRIEVE_MIN ||
    retrieveCount > RETRIEVE_MAX;
  const isSaving = uploadMutation.isLoading || updateMutation.isLoading;
  const canSave = !nameInvalid && !retrieveInvalid && (isEdit || form.llmModel !== '') && !isSaving;

  const submit = () => {
    if (!canSave) {
      return;
    }
    if (isEdit && knowledgeBase != null) {
      updateMutation.mutate({
        id: knowledgeBase.id,
        data: {
          name: trimmedName,
          description: form.description,
          new_max_retrieve_count: retrieveCount,
          allowed_user_ids: form.allowedUserIds,
          allowed_user_group_ids: form.allowedUserGroupIds,
        },
      });
      return;
    }

    const data = new FormData();
    data.append('knowledgeName', trimmedName);
    data.append('description', form.description);
    data.append('tags', form.tags);
    data.append('llmModel', form.llmModel);
    data.append('embeddingModel', form.embeddingModel);
    data.append('rerankModel', form.rerankModel);
    data.append('maxRetrieveCount', String(retrieveCount));
    data.append('allowedUserIds', JSON.stringify(form.allowedUserIds));
    data.append('allowedUserGroupIds', JSON.stringify(form.allowedUserGroupIds));
    if (file != null) {
      data.append('file', file);
    }
    uploadMutation.mutate(data);
  };

  /**
   * An empty list means pwc_tars offered no usable model — its API key check or
   * health probe rejected them all. A disabled picker cannot say that, so the
   * reason is spelled out instead of leaving a control that does nothing.
   */
  const modelField = (
    id: string,
    label: string,
    key: 'llmModel' | 'embeddingModel' | 'rerankModel',
    options: { id: string; name: string }[],
  ) => (
    <div className="space-y-1.5">
      <Label id={`${id}-label`}>{label}</Label>
      {!modelsQuery.isFetching && options.length === 0 ? (
        <p className="flex h-10 items-center rounded-md border border-border-light px-3 text-sm text-text-secondary">
          {localize('com_ui_tars_kb_no_models')}
        </p>
      ) : (
        <Dropdown
          value={form[key]}
          onChange={(value) => set(key, value)}
          options={options.map((option) => ({ value: option.id, label: option.name }))}
          aria-labelledby={`${id}-label`}
          searchable={options.length > 8}
          searchPlaceholder={localize('com_ui_tars_audit_search_placeholder')}
          searchEmptyText={localize('com_ui_no_results_found')}
          disabled={modelsQuery.isFetching}
          sizeClasses="w-full"
          className="w-full"
        />
      )}
    </div>
  );

  return (
    <OGDialog open={true} onOpenChange={(open) => !open && onClose()}>
      <OGDialogTemplate
        title={localize(isEdit ? 'com_ui_tars_kb_edit' : 'com_ui_tars_kb_new')}
        showCloseButton={true}
        className="w-11/12 md:max-w-3xl"
        /** The pickers are wide; without this the footer is pushed off the dialog. */
        mainClassName="min-w-0"
        main={
          <div className="max-h-[70vh] min-w-0 space-y-4 overflow-y-auto pr-1">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="tars-kb-name">
                  {localize('com_ui_tars_kb_name')}
                  <span className="ml-0.5 text-pwc-danger">*</span>
                </Label>
                <Input
                  id="tars-kb-name"
                  value={form.name}
                  onChange={(event) => set('name', event.target.value)}
                  placeholder={localize('com_ui_tars_kb_name_placeholder')}
                />
                {form.name !== '' && nameInvalid && (
                  <p className="text-xs text-pwc-danger">
                    {localize('com_ui_tars_kb_name_invalid', {
                      0: String(NAME_MIN),
                      1: String(NAME_MAX),
                    })}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tars-kb-retrieve">
                  {localize('com_ui_tars_kb_max_retrieve')}
                  <span className="ml-0.5 text-pwc-danger">*</span>
                </Label>
                <Input
                  id="tars-kb-retrieve"
                  type="number"
                  min={RETRIEVE_MIN}
                  max={RETRIEVE_MAX}
                  value={form.maxRetrieveCount}
                  onChange={(event) => set('maxRetrieveCount', event.target.value)}
                />
                {retrieveInvalid && (
                  <p className="text-xs text-pwc-danger">
                    {localize('com_ui_tars_kb_max_retrieve_invalid', {
                      0: String(RETRIEVE_MIN),
                      1: String(RETRIEVE_MAX),
                    })}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tars-kb-description">{localize('com_ui_description')}</Label>
              <textarea
                id="tars-kb-description"
                rows={2}
                value={form.description}
                onChange={(event) => set('description', event.target.value)}
                placeholder={localize('com_ui_tars_kb_description_placeholder')}
                className="w-full rounded-md border border-border-light bg-surface-primary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-border-heavy"
              />
            </div>

            {!isEdit && (
              <>
                <div className="grid gap-4 sm:grid-cols-3">
                  {modelField(
                    'tars-kb-llm',
                    localize('com_ui_tars_kb_llm_model'),
                    'llmModel',
                    modelsQuery.data?.llm ?? [],
                  )}
                  {modelField(
                    'tars-kb-embedding',
                    localize('com_ui_tars_kb_embedding_model'),
                    'embeddingModel',
                    modelsQuery.data?.embedding ?? [],
                  )}
                  {modelField(
                    'tars-kb-rerank',
                    localize('com_ui_tars_kb_rerank_model'),
                    'rerankModel',
                    modelsQuery.data?.rerank ?? [],
                  )}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="tars-kb-tags">{localize('com_ui_tars_kb_tags')}</Label>
                    <Input
                      id="tars-kb-tags"
                      value={form.tags}
                      onChange={(event) => set('tags', event.target.value)}
                      placeholder={localize('com_ui_tars_kb_tags_placeholder')}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="tars-kb-file">{localize('com_ui_tars_kb_seed_file')}</Label>
                    <Input
                      id="tars-kb-file"
                      type="file"
                      onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                    />
                  </div>
                </div>
              </>
            )}

            <div className="space-y-3 rounded-lg border border-border-light p-3">
              <p className="text-sm font-medium text-text-primary">
                {localize('com_ui_tars_kb_access')}
              </p>
              {/* An empty selection is pwc_tars' way of saying "no restriction". */}
              <p className="text-xs text-text-secondary">
                {localize('com_ui_tars_kb_access_hint')}
              </p>
              <Picker
                id="tars-kb-users"
                label={localize('com_ui_tars_kb_allowed_users')}
                options={userOptions}
                selected={form.allowedUserIds}
                onChange={(values) => set('allowedUserIds', values)}
                placeholder={localize('com_ui_tars_kb_access_everyone')}
              />
              <Picker
                id="tars-kb-groups"
                label={localize('com_ui_tars_kb_allowed_groups')}
                options={groupOptions}
                selected={form.allowedUserGroupIds}
                onChange={(values) => set('allowedUserGroupIds', values)}
                placeholder={localize('com_ui_tars_kb_access_everyone')}
              />
            </div>
          </div>
        }
        buttons={
          <Button variant="submit" onClick={submit} disabled={!canSave}>
            {isSaving ? <Spinner className="size-4" /> : localize('com_ui_save')}
          </Button>
        }
      />
    </OGDialog>
  );
}
