import { useMemo } from 'react';
import { Spinner } from '@librechat/client';
import { useFormContext, useWatch } from 'react-hook-form';
import {
  TARS_DATABASE_SWITCHES,
  TARS_SINGLE_KNOWLEDGE_SWITCHES,
  TARS_REQUIRED_KNOWLEDGE_SWITCHES,
} from 'librechat-data-provider';
import type { TTarsToolSwitch, TTarsAgentKnowledgeBases } from 'librechat-data-provider';
import type { PickerOption } from '~/components/Admin/Tars/Audit/Picker';
import type { TranslationKeys } from '~/hooks/useLocalize';
import type { AgentForm } from '~/common';
import { useTarsChatKnowledgeBasesQuery } from '~/data-provider';
import Picker from '~/components/Admin/Tars/Audit/Picker';
import { useLocalize } from '~/hooks';

const HINT_KEYS: Record<TTarsToolSwitch, TranslationKeys> = {
  rag_agent: 'com_agents_tars_kb_hint_rag',
  sql_agent: 'com_agents_tars_kb_hint_sql',
  chart_agent: 'com_agents_tars_kb_hint_chart',
  file_agent: 'com_agents_tars_kb_hint_file',
};

const NO_PICKS: string[] = [];

/**
 * The knowledge bases one TARS tool reaches on this agent (`tars_knowledge_bases`). The
 * list is the editor's own chat list, databases only for 資料庫查詢 / 產生圖表 / 產生檔案;
 * a pick the editor cannot use (made by someone else) stays listed, marked, and can be
 * removed, so opening the dialog never drops it. Whoever chats with the agent reaches
 * only the picks on their own chat list.
 */
export default function TarsKnowledgeConfig({ toolSwitch }: { toolSwitch: TTarsToolSwitch }) {
  const localize = useLocalize();
  const { control, setValue } = useFormContext<AgentForm>();
  const picks = useWatch({ control, name: 'tars_knowledge_bases' }) as
    | TTarsAgentKnowledgeBases
    | undefined;
  const { data: chatList = [], isLoading } = useTarsChatKnowledgeBasesQuery();

  const databasesOnly = TARS_DATABASE_SWITCHES.includes(toolSwitch);
  const single = TARS_SINGLE_KNOWLEDGE_SWITCHES.includes(toolSwitch);
  const required = TARS_REQUIRED_KNOWLEDGE_SWITCHES.includes(toolSwitch);
  const selected = picks?.[toolSwitch] ?? NO_PICKS;

  const offered = useMemo(
    () => chatList.filter((kb) => !databasesOnly || kb.has_sql_database === true),
    [chatList, databasesOnly],
  );
  const options = useMemo<PickerOption[]>(() => {
    const known = new Set(offered.map((kb) => kb.id));
    const unreachable = selected
      .filter((id) => !known.has(id))
      .map((id) => ({ value: id, label: localize('com_agents_tars_kb_unavailable', { 0: id }) }));
    return [...offered.map((kb) => ({ value: kb.id, label: kb.name })), ...unreachable];
  }, [offered, selected, localize]);

  const onChange = (values: string[]) =>
    setValue('tars_knowledge_bases', { ...picks, [toolSwitch]: values }, { shouldDirty: true });

  const labelKey: TranslationKeys = databasesOnly
    ? 'com_agents_tars_kb_databases'
    : 'com_agents_tars_kb_knowledge_bases';
  const emptyKey: TranslationKeys = databasesOnly
    ? 'com_agents_tars_kb_no_databases'
    : 'com_agents_tars_kb_no_knowledge_bases';

  return (
    <div className="flex flex-col gap-3">
      {isLoading ? (
        <div className="text-text-secondary flex items-center gap-2 text-sm" role="status">
          <Spinner className="size-4" />
          {localize('com_ui_loading')}
        </div>
      ) : (
        <Picker
          id={`tars-kb-${toolSwitch}`}
          label={localize(labelKey) + (required ? ' *' : '')}
          options={options}
          selected={selected}
          onChange={onChange}
          placeholder={localize(
            single ? 'com_agents_tars_kb_select_one' : 'com_agents_tars_kb_select_many',
          )}
          single={single}
          chips
        />
      )}
      {!isLoading && offered.length === 0 && (
        <p className="text-text-secondary text-sm">{localize(emptyKey)}</p>
      )}
      {!isLoading && required && selected.length === 0 && (
        <p className="text-status-error text-sm" role="alert">
          {localize('com_agents_tars_kb_required_inline')}
        </p>
      )}
      <p className="text-text-secondary text-sm leading-relaxed">
        {localize(HINT_KEYS[toolSwitch])}
      </p>
    </div>
  );
}
