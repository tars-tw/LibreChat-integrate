import { Cloud, User, BookText } from 'lucide-react';
import type { TTarsPromptScope } from 'librechat-data-provider';
import type { LucideIcon } from 'lucide-react';
import type { TranslationKeys } from '~/hooks';

/** The tiers a chat lists, in display order: an agent binds no 專用腦, so there is no brain tier. */
export const CHAT_PROMPT_SCOPES = [
  'knowledge_base',
  'personal',
] as const satisfies readonly TTarsPromptScope[];

export type ChatPromptScope = (typeof CHAT_PROMPT_SCOPES)[number];

/** Each tier's group header, shared by the chat composer's panel and the prompts side panel. */
export const PROMPT_SCOPE_META: Record<
  TTarsPromptScope,
  { icon: LucideIcon; labelKey: TranslationKeys; colorClass: string }
> = {
  domain: { icon: Cloud, labelKey: 'com_ui_tars_prompts_domain', colorClass: 'text-blue-500' },
  knowledge_base: {
    icon: BookText,
    labelKey: 'com_ui_tars_prompts_kb',
    colorClass: 'text-purple-400',
  },
  personal: {
    icon: User,
    labelKey: 'com_ui_tars_prompts_personal',
    colorClass: 'text-pwc-orange-600',
  },
};
