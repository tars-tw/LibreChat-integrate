import { useState } from 'react';
import { CopyPlus } from 'lucide-react';
import { Button, Spinner, Tabs, TabsContent, TabsList, TabsTrigger } from '@librechat/client';
import type { PickerOption } from '../Audit/Picker';
import type { AccessKind } from './helpers';
import { ACCESS_LABEL_KEYS } from './Access';
import { useLocalize } from '~/hooks';
import Picker from '../Audit/Picker';

/** One of a knowledge base's two lists, as the pickers edit it. */
export interface PrincipalLists {
  users: string[];
  groups: string[];
}

export const EMPTY_LISTS: PrincipalLists = { users: [], groups: [] };

const listSize = (lists: PrincipalLists): number => lists.users.length + lists.groups.length;

const union = (current: string[], added: string[]): string[] => [
  ...current,
  ...added.filter((id) => !current.includes(id)),
];

/** Whether adding `source` would change `target` — the add button is idle otherwise. */
const addsSomething = (target: PrincipalLists, source: PrincipalLists): boolean =>
  source.users.some((id) => !target.users.includes(id)) ||
  source.groups.some((id) => !target.groups.includes(id));

/** Loading the chat list before an edit; `error` leaves it untouched on save. */
export type ChatListStatus = 'ready' | 'loading' | 'error';

/**
 * The two lists of a knowledge base, side by side in one card:
 *
 * - 管理權限 (`knowledge_base.allowed_*`): who sees the knowledge base in 知識庫清單 and
 *   manages its files. Admin-only, so anyone else sees only the chat tab.
 * - 聊天使用 (`km_permission`): who may use it in chat. Admins and the knowledge base's
 *   managers set it; nobody is on it until someone is added, admins included.
 */
export default function KnowledgePermissions({
  canManageAccess,
  manage,
  onManageChange,
  chat,
  onChatChange,
  chatStatus,
  copySource,
  userOptions,
  groupOptions,
  chatUserOptions,
  chatGroupOptions,
}: {
  canManageAccess: boolean;
  manage: PrincipalLists;
  onManageChange: (lists: PrincipalLists) => void;
  chat: PrincipalLists;
  onChatChange: (lists: PrincipalLists) => void;
  chatStatus: ChatListStatus;
  /** The management list the add button copies from, whether or not its tab is shown. */
  copySource: PrincipalLists;
  userOptions: PickerOption[];
  groupOptions: PickerOption[];
  /** The pickable users plus disabled ones already on the chat list, which may only go. */
  chatUserOptions: PickerOption[];
  chatGroupOptions: PickerOption[];
}) {
  const localize = useLocalize();
  const [tab, setTab] = useState<AccessKind>('manage');
  const chatReady = chatStatus === 'ready';

  const tabLabel = (kind: AccessKind, count: number) => (
    <>
      {localize(ACCESS_LABEL_KEYS[kind])}
      <span className="bg-surface-tertiary text-text-secondary ml-1.5 rounded-full px-1.5 text-xs tabular-nums">
        {count}
      </span>
    </>
  );

  const manageFields = (
    <div className="space-y-3">
      <p className="text-text-secondary text-xs">{localize('com_ui_tars_kb_manage_hint')}</p>
      <Picker
        id="tars-kb-manage-users"
        label={localize('com_ui_tars_kb_manage_users')}
        options={userOptions}
        selected={manage.users}
        onChange={(users) => onManageChange({ ...manage, users })}
        placeholder={localize('com_ui_tars_kb_manage_select_users')}
        chips
      />
      <Picker
        id="tars-kb-manage-groups"
        label={localize('com_ui_tars_kb_manage_groups')}
        options={groupOptions}
        selected={manage.groups}
        onChange={(groups) => onManageChange({ ...manage, groups })}
        placeholder={localize('com_ui_tars_kb_manage_select_groups')}
        chips
      />
    </div>
  );

  const chatFields = (
    <div className="space-y-3">
      <p className="text-text-secondary text-xs">{localize('com_ui_tars_kb_chat_hint')}</p>
      {chatStatus === 'loading' && (
        <div className="text-text-secondary flex items-center gap-2 text-xs" role="status">
          <Spinner className="size-4" />
          {localize('com_ui_loading')}
        </div>
      )}
      {chatStatus === 'error' && (
        <p className="text-status-error text-xs" role="alert">
          {localize('com_ui_tars_kb_chat_load_failed')}
        </p>
      )}
      <Picker
        id="tars-kb-chat-users"
        label={localize('com_ui_tars_kb_chat_users')}
        options={chatUserOptions}
        selected={chat.users}
        onChange={(users) => onChatChange({ ...chat, users })}
        placeholder={localize('com_ui_tars_kb_chat_select_users')}
        disabled={!chatReady}
        chips
      />
      <Picker
        id="tars-kb-chat-groups"
        label={localize('com_ui_tars_kb_chat_groups')}
        options={chatGroupOptions}
        selected={chat.groups}
        onChange={(groups) => onChatChange({ ...chat, groups })}
        placeholder={localize('com_ui_tars_kb_chat_select_groups')}
        disabled={!chatReady}
        chips
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          onChatChange({
            users: union(chat.users, copySource.users),
            groups: union(chat.groups, copySource.groups),
          })
        }
        disabled={!chatReady || !addsSomething(chat, copySource)}
        title={localize('com_ui_tars_kb_chat_copy_manage_hint')}
      >
        <CopyPlus className="mr-1.5 size-4" aria-hidden />
        {localize('com_ui_tars_kb_chat_copy_manage')}
      </Button>
    </div>
  );

  if (!canManageAccess) {
    return (
      <section className="border-border-light min-w-0 self-start rounded-lg border px-6 pt-4 pb-6">
        <h3 className="text-text-primary mb-3 text-sm font-medium">
          {tabLabel('chat', listSize(chat))}
        </h3>
        {chatFields}
      </section>
    );
  }

  return (
    <section
      className="border-border-light min-w-0 self-start rounded-lg border"
      aria-label={localize('com_ui_tars_kb_permissions')}
    >
      <Tabs value={tab} onValueChange={(value) => setTab(value as AccessKind)}>
        <div className="space-y-2 px-6 pt-4">
          <h3 className="text-text-primary text-sm font-medium">
            {localize('com_ui_tars_kb_permissions')}
          </h3>
          <TabsList variant="underline">
            <TabsTrigger value="manage" variant="underline">
              {tabLabel('manage', listSize(manage))}
            </TabsTrigger>
            <TabsTrigger value="chat" variant="underline">
              {tabLabel('chat', listSize(chat))}
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="manage">{manageFields}</TabsContent>
        <TabsContent value="chat">{chatFields}</TabsContent>
      </Tabs>
    </section>
  );
}
