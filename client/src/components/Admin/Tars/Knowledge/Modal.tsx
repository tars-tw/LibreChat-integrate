import { useCallback, useEffect, useMemo, useState } from 'react';
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
import type {
  TTarsKnowledgeBase,
  TTarsPrincipalInfo,
  TTarsKnowledgeBaseUser,
  TTarsKnowledgeBaseGroup,
} from 'librechat-data-provider';
import type { ChatListStatus, PrincipalLists } from './Permissions';
import type { PickerOption } from '../Audit/Picker';
import {
  useTarsModelOptionsQuery,
  useUpdateTarsKnowledgeBaseMutation,
  useUploadTarsKnowledgeBaseMutation,
  useTarsKnowledgeBaseChatAssigneesQuery,
  useSaveTarsKnowledgeBaseChatPermissionsMutation,
} from '~/data-provider';
import {
  DEFAULT_MAX_RETRIEVE,
  relayedError,
  groupPickerOptions,
  userPickerOptions,
} from './helpers';
import KnowledgePermissions, { EMPTY_LISTS } from './Permissions';
import { useLocalize } from '~/hooks';

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
}

const emptyForm: FormState = {
  name: '',
  description: '',
  tags: '',
  maxRetrieveCount: String(DEFAULT_MAX_RETRIEVE),
  llmModel: '',
  embeddingModel: '',
  rerankModel: '',
};

const listsOf = (principals: TTarsPrincipalInfo[]): PrincipalLists => ({
  users: principals.filter((p) => p.principal_type === 'user').map((p) => p.principal_id),
  groups: principals.filter((p) => p.principal_type === 'group').map((p) => p.principal_id),
});

const sameIds = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((id) => b.includes(id));

const sameLists = (a: PrincipalLists, b: PrincipalLists): boolean =>
  sameIds(a.users, b.users) && sameIds(a.groups, b.groups);

const toPrincipals = ({ users, groups }: PrincipalLists) => [
  ...users.map((principal_id) => ({ principal_type: 'user' as const, principal_id })),
  ...groups.map((principal_id) => ({ principal_type: 'group' as const, principal_id })),
];

/**
 * The pickers list active users and groups only. A principal already on the chat list
 * but missing there (a disabled one) joins its options, marked, so it shows by name
 * and can be taken off.
 */
const withAssigned = (
  options: PickerOption[],
  assigned: TTarsPrincipalInfo[] | undefined,
  type: TTarsPrincipalInfo['principal_type'],
  disabledLabel: (name: string) => string,
): PickerOption[] => {
  const known = new Set(options.map((option) => option.value));
  const extra = (assigned ?? [])
    .filter((p) => p.principal_type === type && !known.has(p.principal_id))
    .map((p) => {
      const name = p.name || p.principal_id;
      return { value: p.principal_id, label: p.is_active ? name : disabledLabel(name) };
    });
  return extra.length > 0 ? [...options, ...extra] : options;
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
 *
 * The chat list (`km_permission`) has its own endpoint, saved after the base:
 * a new base only has an id once pwc_tars has created it.
 */
export default function KnowledgeModal({
  knowledgeBase,
  users,
  groups,
  canManageAccess,
  onClose,
}: {
  /** `null` opens the create form. */
  knowledgeBase: TTarsKnowledgeBase | null;
  users: TTarsKnowledgeBaseUser[];
  groups: TTarsKnowledgeBaseGroup[];
  /**
   * Only admins see and send the management list, as on pwc_tars's own page; the
   * proxy refuses it from anyone else. The knowledge base's managers still set
   * the chat list.
   */
  canManageAccess: boolean;
  onClose: () => void;
}) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const isEdit = knowledgeBase != null;

  const [form, setForm] = useState<FormState>(emptyForm);
  const [file, setFile] = useState<File | null>(null);
  const [manage, setManage] = useState<PrincipalLists>(EMPTY_LISTS);
  const [chat, setChat] = useState<PrincipalLists>(EMPTY_LISTS);
  /** The chat list as loaded; `null` until it is, so a save never overwrites an unread list. */
  const [chatLoaded, setChatLoaded] = useState<PrincipalLists | null>(isEdit ? null : EMPTY_LISTS);

  const chatQuery = useTarsKnowledgeBaseChatAssigneesQuery(knowledgeBase?.id ?? null);

  const modelsQuery = useTarsModelOptionsQuery({ enabled: !isEdit });

  const userOptions = useMemo(() => userPickerOptions(users), [users]);
  const groupOptions = useMemo(() => groupPickerOptions(groups), [groups]);

  const disabledLabel = useCallback(
    (name: string) => localize('com_ui_tars_kb_disabled_principal', { 0: name }),
    [localize],
  );
  const chatUserOptions = useMemo(
    () => withAssigned(userOptions, chatQuery.data, 'user', disabledLabel),
    [userOptions, chatQuery.data, disabledLabel],
  );
  const chatGroupOptions = useMemo(
    () => withAssigned(groupOptions, chatQuery.data, 'group', disabledLabel),
    [groupOptions, chatQuery.data, disabledLabel],
  );

  useEffect(() => {
    if (!isEdit || chatLoaded != null || chatQuery.data == null) {
      return;
    }
    const lists = listsOf(chatQuery.data);
    setChat(lists);
    setChatLoaded(lists);
  }, [isEdit, chatLoaded, chatQuery.data]);

  let chatStatus: ChatListStatus = 'loading';
  if (chatLoaded != null) {
    chatStatus = 'ready';
  } else if (chatQuery.isError) {
    chatStatus = 'error';
  }

  /** The stored management list: what the add button copies when its tab is hidden. */
  const storedManage = useMemo<PrincipalLists>(
    () => ({
      users: knowledgeBase?.allowed_user_ids ?? [],
      groups: knowledgeBase?.allowed_user_group_ids ?? [],
    }),
    [knowledgeBase],
  );

  useEffect(() => {
    if (knowledgeBase == null) {
      setForm(emptyForm);
      setFile(null);
      setManage(EMPTY_LISTS);
      return;
    }
    setForm({
      ...emptyForm,
      name: knowledgeBase.name,
      description: knowledgeBase.description ?? '',
      maxRetrieveCount: String(knowledgeBase.max_retrieve_count ?? DEFAULT_MAX_RETRIEVE),
    });
    setManage(storedManage);
  }, [knowledgeBase, storedManage]);

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

  const uploadMutation = useUploadTarsKnowledgeBaseMutation();
  const updateMutation = useUpdateTarsKnowledgeBaseMutation();
  const chatMutation = useSaveTarsKnowledgeBaseChatPermissionsMutation();

  const trimmedName = form.name.trim();
  const retrieveCount = Number(form.maxRetrieveCount);
  const nameInvalid = trimmedName.length < NAME_MIN || trimmedName.length > NAME_MAX;
  const retrieveInvalid =
    !Number.isInteger(retrieveCount) ||
    retrieveCount < RETRIEVE_MIN ||
    retrieveCount > RETRIEVE_MAX;
  const isSaving = uploadMutation.isLoading || updateMutation.isLoading || chatMutation.isLoading;
  const canSave =
    !nameInvalid &&
    !retrieveInvalid &&
    (isEdit || form.llmModel !== '') &&
    chatStatus !== 'loading' &&
    !isSaving;

  const failed = (
    error: unknown,
    fallback: 'com_ui_tars_kb_save_failed' | 'com_ui_tars_kb_chat_save_failed',
  ) => showToast({ message: relayedError(error) ?? localize(fallback), status: 'error' });

  const saved = () => {
    showToast({ message: localize('com_ui_tars_kb_saved'), status: 'success' });
    onClose();
  };

  /** Saves the chat list; on failure says so, since the knowledge base itself was saved. */
  const saveChat = async (knowledgeBaseId: string): Promise<boolean> => {
    try {
      await chatMutation.mutateAsync({ knowledgeBaseId, data: { principals: toPrincipals(chat) } });
      return true;
    } catch (error) {
      showToast({
        message: localize('com_ui_tars_kb_chat_save_failed', {
          0: relayedError(error) ?? localize('com_ui_tars_kb_save_failed'),
        }),
        status: 'error',
      });
      return false;
    }
  };

  const submitEdit = async (id: string) => {
    try {
      await updateMutation.mutateAsync({
        id,
        data: {
          name: trimmedName,
          description: form.description,
          new_max_retrieve_count: retrieveCount,
          ...(canManageAccess
            ? { allowed_user_ids: manage.users, allowed_user_group_ids: manage.groups }
            : {}),
        },
      });
    } catch (error) {
      failed(error, 'com_ui_tars_kb_save_failed');
      return;
    }
    /** An unread list is left alone; an unchanged one is not rewritten (nor audited). */
    /** On failure the dialog stays open with the edits, so saving again retries. */
    if (chatLoaded != null && !sameLists(chat, chatLoaded) && !(await saveChat(id))) {
      return;
    }
    saved();
  };

  const submit = async () => {
    if (!canSave) {
      return;
    }
    if (isEdit && knowledgeBase != null) {
      await submitEdit(knowledgeBase.id);
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
    data.append('allowedUserIds', JSON.stringify(manage.users));
    data.append('allowedUserGroupIds', JSON.stringify(manage.groups));
    if (file != null) {
      data.append('file', file);
    }
    let created: Record<string, unknown>;
    try {
      created = await uploadMutation.mutateAsync(data);
    } catch (error) {
      failed(error, 'com_ui_tars_kb_save_failed');
      return;
    }
    const createdId = created?.knowledge_base_id;
    if (chat.users.length + chat.groups.length > 0) {
      /** The base exists either way, so the dialog closes; the list can be set again by editing it. */
      if (typeof createdId !== 'string' || !(await saveChat(createdId))) {
        onClose();
        return;
      }
    }
    saved();
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
        <p className="border-border-light text-text-secondary flex h-10 items-center rounded-md border px-3 text-sm">
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
          variant="field"
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
        /**
         * The access pickers open their lists inline, so any scrolling ancestor
         * clips them. Where the whole form fits, nothing scrolls and the lists
         * may hang past the dialog's edge; shorter screens keep the scroll area.
         */
        className="w-11/12 md:max-w-4xl [@media(min-height:640px)]:overflow-visible"
        /** The pickers are wide; without this the footer is pushed off the dialog. */
        mainClassName="min-w-0"
        main={
          <div className="max-h-[70vh] min-w-0 space-y-4 overflow-y-auto pr-1 [@media(min-height:640px)]:max-h-none [@media(min-height:640px)]:overflow-visible">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="min-w-0 space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="tars-kb-name">
                    {localize('com_ui_tars_kb_name')}
                    <span className="text-pwc-danger ml-0.5">*</span>
                  </Label>
                  <Input
                    id="tars-kb-name"
                    value={form.name}
                    onChange={(event) => set('name', event.target.value)}
                    placeholder={localize('com_ui_tars_kb_name_placeholder')}
                  />
                  {form.name !== '' && nameInvalid && (
                    <p className="text-pwc-danger text-xs">
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
                    <span className="text-pwc-danger ml-0.5">*</span>
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
                    <p className="text-pwc-danger text-xs">
                      {localize('com_ui_tars_kb_max_retrieve_invalid', {
                        0: String(RETRIEVE_MIN),
                        1: String(RETRIEVE_MAX),
                      })}
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="tars-kb-description">{localize('com_ui_description')}</Label>
                  <textarea
                    id="tars-kb-description"
                    rows={2}
                    value={form.description}
                    onChange={(event) => set('description', event.target.value)}
                    placeholder={localize('com_ui_tars_kb_description_placeholder')}
                    className="border-border-light bg-surface-primary text-text-primary focus:ring-border-heavy w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
                  />
                </div>
              </div>

              <KnowledgePermissions
                canManageAccess={canManageAccess}
                manage={manage}
                onManageChange={setManage}
                chat={chat}
                onChatChange={setChat}
                chatStatus={chatStatus}
                copySource={canManageAccess ? manage : storedManage}
                userOptions={userOptions}
                groupOptions={groupOptions}
                chatUserOptions={chatUserOptions}
                chatGroupOptions={chatGroupOptions}
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
