import React from 'react';
import { render } from '@testing-library/react';
import { TARS_BUILTIN_TOOLS } from 'librechat-data-provider';
import type { TTarsTraceRow } from 'librechat-data-provider';
import { getTarsToolCopy } from '~/components/Chat/Messages/Content/tars';
import { RowIcon, rowLabel, toolLabel } from '../icons';
import en from '~/locales/en/translation.json';

/** The shipped catalog with i18next's `{{name}}` interpolation. */
const t = (key: string, options?: Record<string, string | number>) =>
  ((en as Record<string, string>)[key] ?? key).replace(/{{(\w+)}}/g, (_, name: string) =>
    String(options?.[name] ?? ''),
  );

const row = (fields: Partial<TTarsTraceRow>): TTarsTraceRow => ({
  id: 'r-1',
  seq: 1,
  message_id: 'm-1',
  event_type: 'tool_result',
  turn: 1,
  tool_name: null,
  tool_use_id: null,
  parent_id: null,
  attempt: 1,
  retry_of: null,
  started_at: null,
  ended_at: null,
  duration_ms: null,
  ok: null,
  payload: null,
  ...fields,
});

const iconClass = (element: React.ReactElement) =>
  render(element).container.querySelector('svg')?.getAttribute('class') ?? '';

describe('trace tool names', () => {
  it('names a pwc_tars built-in as its chat card does, under either name', () => {
    const chatName = t(getTarsToolCopy('tars_knowledge_search').name);
    expect(toolLabel(t, 'tars_knowledge_search')).toBe(chatName);
    expect(toolLabel(t, 'knowledge_search')).toBe(chatName);
    /** pwc_tars traces the table task under a name of its own. */
    expect(toolLabel(t, 'run_table_task')).toBe(t(getTarsToolCopy('tars_table_task').name));
  });

  it('names pwc_tars agent tools, plugins, MCP tools and native tools', () => {
    expect(toolLabel(t, 'delegate')).toBe(en.com_ui_tars_trace_tool_delegate);
    expect(toolLabel(t, 'tars_plugin_summarize_text')).toBe('summarize_text');
    /** The server is left out of the label; the stored name keeps it. */
    expect(toolLabel(t, 'get_models_mcp_tars_vLLM')).toBe('get_models');
    expect(toolLabel(t, 'execute_code')).toBe('execute_code');
  });

  it('names an event that is not a tool by the event', () => {
    expect(rowLabel(t, row({ event_type: 'thinking' }))).toBe(en.com_ui_tars_audit_trace_thinking);
  });
});

describe('trace tool icons', () => {
  /** The same call must look the same in the chat and in the audit trace. */
  it.each(Object.entries(TARS_BUILTIN_TOOLS))(
    'draws %s with its chat card’s icon, under either name',
    (name, tarsName) => {
      const ChatIcon = getTarsToolCopy(name).icon;
      const chatIcon = iconClass(<ChatIcon />).split(' ')[1];
      expect(chatIcon).toMatch(/^lucide-/);
      for (const toolName of [name, tarsName]) {
        expect(iconClass(<RowIcon row={row({ tool_name: toolName })} />)).toContain(chatIcon);
      }
    },
  );

  it('draws every kind of row', () => {
    for (const fields of [
      { tool_name: 'delegate' },
      { tool_name: 'tars_plugin_summarize_text' },
      { tool_name: 'get_models_mcp_tars_vLLM' },
      { tool_name: 'execute_code' },
      { tool_name: null, event_type: 'thinking' },
      { tool_name: null, event_type: 'langflow_route' },
    ]) {
      expect(iconClass(<RowIcon row={row(fields)} />)).not.toBe('');
    }
  });
});
