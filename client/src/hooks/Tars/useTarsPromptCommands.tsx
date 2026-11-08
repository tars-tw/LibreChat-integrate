import { useMemo } from 'react';
import type { TPromptGroup, TTarsPrompt, TTarsPromptScope } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks/useLocalize';
import type { PromptOption } from '~/common';
import CategoryIcon from '~/components/Prompts/utils/CategoryIcon';
import useTarsChatPrompts from './useTarsChatPrompts';
import useLocalize from '~/hooks/useLocalize';
import { tarsPromptAsGroup } from '~/utils';

const SCOPE_LABELS: Record<TTarsPromptScope, TranslationKeys> = {
  domain: 'com_ui_tars_prompts_domain',
  knowledge_base: 'com_ui_tars_prompts_kb',
  personal: 'com_ui_tars_prompts_personal',
};

export type TarsPromptCommands = {
  promptGroups: PromptOption[];
  promptsMap: Record<string, TPromptGroup>;
};

/**
 * Shapes pwc_tars prompts the way the slash-command picker reads LibreChat
 * prompt groups: `value` is the command (else the name) and the label leads
 * with `/command`, so typing after `/` matches either. Ids are scope-qualified
 * because each tier lives in its own pwc_tars table.
 */
export const toTarsPromptCommands = (
  prompts: TTarsPrompt[],
  scopeLabel: (prompt: TTarsPrompt) => string,
): TarsPromptCommands =>
  prompts.reduce<TarsPromptCommands>(
    (acc, prompt) => {
      const id = `${prompt.scope ?? 'personal'}:${prompt.id}`;
      const command = prompt.command?.trim();
      const snippet = prompt.description?.trim() || prompt.content;
      acc.promptGroups.push({
        id,
        type: 'prompt',
        value: command || prompt.name,
        label: `${command ? `/${command} - ` : ''}${prompt.name}: ${snippet}`,
        description: scopeLabel(prompt),
        icon: <CategoryIcon category={prompt.category ?? ''} className="h-5 w-5" />,
      });
      acc.promptsMap[id] = tarsPromptAsGroup(prompt);
      return acc;
    },
    { promptGroups: [], promptsMap: {} },
  );

/**
 * The slash-command picker's source: the same list as 「我的提示」 — personal
 * prompts plus those of the knowledge bases the selected agent's 知識庫檢索
 * picked. Fetched only once the picker opens.
 */
export default function useTarsPromptCommands(enabled: boolean): {
  data?: TarsPromptCommands;
  isLoading: boolean;
} {
  const localize = useLocalize();
  const { data, isInitialLoading } = useTarsChatPrompts(enabled);

  const commands = useMemo(() => {
    if (!data) {
      return undefined;
    }
    return toTarsPromptCommands(data.prompts, (prompt) => {
      const scope = prompt.scope ?? 'personal';
      if (scope === 'knowledge_base' && prompt.knowledge_base_name) {
        return prompt.knowledge_base_name;
      }
      return localize(SCOPE_LABELS[scope]);
    });
  }, [data, localize]);

  return { data: commands, isLoading: isInitialLoading };
}
