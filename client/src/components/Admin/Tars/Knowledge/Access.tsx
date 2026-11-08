import { MessagesSquare, UserCog } from 'lucide-react';
import type { TTarsKnowledgeBase } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import type { AccessKind } from './helpers';
import { accessCounts } from './helpers';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

const ICONS = { manage: UserCog, chat: MessagesSquare } as const;

export const ACCESS_LABEL_KEYS: Record<AccessKind, TranslationKeys> = {
  manage: 'com_ui_tars_kb_manage_tab',
  chat: 'com_ui_tars_kb_chat_tab',
};

/** What an empty list means: management falls back to admins, chat to nobody. */
const EMPTY_KEYS: Record<AccessKind, TranslationKeys> = {
  manage: 'com_ui_tars_kb_manage_admins_only',
  chat: 'com_ui_tars_kb_chat_unset',
};

/**
 * How many users and groups one of a knowledge base's two lists holds — the management
 * list (who manages it in 知識庫清單) or the chat list (who may use it in chat).
 */
export default function AccessSummary({
  knowledgeBase,
  kind,
  withIcon = false,
}: {
  knowledgeBase: TTarsKnowledgeBase;
  kind: AccessKind;
  /** Cards show which list it is with an icon; table columns already say it in the header. */
  withIcon?: boolean;
}) {
  const localize = useLocalize();
  const { users, groups } = accessCounts(knowledgeBase, kind);
  const parts = [
    users > 0 ? localize('com_ui_tars_kb_count_users', { 0: String(users) }) : null,
    groups > 0 ? localize('com_ui_tars_kb_count_groups', { 0: String(groups) }) : null,
  ].filter((part): part is string => part != null);
  const empty = parts.length === 0;
  const text = empty ? localize(EMPTY_KEYS[kind]) : parts.join(' · ');
  const label = localize(ACCESS_LABEL_KEYS[kind]);
  const Icon = ICONS[kind];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs whitespace-nowrap',
        empty ? 'text-text-tertiary' : 'text-text-secondary',
      )}
      title={`${label}：${text}`}
    >
      {withIcon && <Icon className="size-3.5 shrink-0" aria-hidden />}
      {withIcon && <span className="sr-only">{label}</span>}
      {text}
    </span>
  );
}
