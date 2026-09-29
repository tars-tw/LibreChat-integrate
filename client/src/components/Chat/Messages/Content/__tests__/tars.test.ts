import { Tools, ContentTypes } from 'librechat-data-provider';
import type { TAttachment, TMessageContentParts } from 'librechat-data-provider';
import {
  splitTarsAnswer,
  getTarsToolLine,
  getTarsPluginAnswer,
  getTarsToolProgress,
} from '../tars';
import { getLiveActivity } from '../live';

const localize = (key: string) => key;

const toolCall = (name: string, args: string, output?: string) =>
  ({
    type: ContentTypes.TOOL_CALL,
    [ContentTypes.TOOL_CALL]: {
      id: 'call-1',
      name,
      args,
      type: 'tool_call',
      progress: output ? 1 : 0.1,
      ...(output ? { output } : {}),
    },
  }) as unknown as TMessageContentParts;

describe('getTarsToolLine', () => {
  it('reads the subject out of args that are still streaming', () => {
    expect(getTarsToolLine('tars_knowledge_search', '{"query":"台北 成田', false, localize)).toBe(
      'com_ui_tars_tool_knowledge_search_running · 台北 成田',
    );
    expect(
      getTarsToolLine('tars_generate_file', '{"title":"報表","file_type":"excel"}', true, localize),
    ).toBe('com_ui_tars_tool_generate_file_done · 報表.excel');
    expect(getTarsToolLine('tars_data_schema', '{}', false, localize)).toBe(
      'com_ui_tars_tool_data_schema_running',
    );
  });

  it('leaves every other tool to its own line', () => {
    expect(getTarsToolLine('web_search', '{"query":"x"}', false, localize)).toBeUndefined();
  });
});

describe('the live fold header over a pwc_tars call', () => {
  it('says what the hidden card says, running and then done', () => {
    const running = getLiveActivity(
      [toolCall('tars_sql_query', '{"purpose":"各幣別餘額","sql":"SELECT 1"}')],
      localize,
      [],
    );
    expect(running.text).toBe('com_ui_tars_tool_sql_query_running · 各幣別餘額');
    expect(running.comboCount).toBe(1);

    const done = getLiveActivity(
      [toolCall('tars_sql_query', '{"purpose":"各幣別餘額","sql":"SELECT 1"}', '| n |')],
      localize,
      [],
    );
    expect(done.text).toBe('com_ui_tars_tool_sql_query_done · 各幣別餘額');
  });
});

const progressAttachment = (toolCallId: string, progress: string) =>
  ({
    type: Tools.tars_trace,
    file_id: `tars-progress-${toolCallId}`,
    toolCallId,
    messageId: 'm1',
    [Tools.tars_trace]: { trace: [], progress },
  }) as unknown as TAttachment;

describe('progress a long pwc_tars call reports', () => {
  it('is read per call and replaces the subject only while the call runs', () => {
    const attachments = [progressAttachment('call-1', '目前正在處理第 1-5 列，共 20 列…')];
    expect(getTarsToolProgress(attachments, 'call-1')).toBe('目前正在處理第 1-5 列，共 20 列…');
    expect(getTarsToolProgress(attachments, 'call-2')).toBeUndefined();

    const args = '{"instruction":"逐列比對"}';
    expect(getTarsToolLine('tars_table_task', args, false, localize, '第 1-5 列')).toBe(
      'com_ui_tars_tool_table_task_running · 第 1-5 列',
    );
    expect(getTarsToolLine('tars_table_task', args, true, localize, '第 1-5 列')).toBe(
      'com_ui_tars_tool_table_task_done · 逐列比對',
    );
  });

  it('reaches the live fold header, for plugin tools as well', () => {
    const running = getLiveActivity(
      [toolCall('tars_table_task', '{"instruction":"逐列比對"}')],
      localize,
      [],
      { 'call-1': [progressAttachment('call-1', '第 6-10 列')] },
    );
    expect(running.text).toBe('com_ui_tars_tool_table_task_running · 第 6-10 列');

    const plugin = getLiveActivity([toolCall('tars_plugin_case_dispatch', '{}')], localize, [], {
      'call-1': [progressAttachment('call-1', '分類中…')],
    });
    expect(plugin.text).toContain('分類中…');
  });
});

describe('splitTarsAnswer', () => {
  it('splits <details> blocks out of a plugin answer', () => {
    const answer =
      '## 結果\n| a | b |\n\n<details>\n<summary>逐項檢查（3 步）</summary>\n\n- 1\\. 是\n</details>\n結尾';
    expect(splitTarsAnswer(answer)).toEqual([
      { type: 'markdown', content: '## 結果\n| a | b |\n\n' },
      { type: 'details', summary: '逐項檢查（3 步）', content: '\n\n- 1\\. 是\n' },
      { type: 'markdown', content: '\n結尾' },
    ]);
  });

  it('keeps an answer without disclosures as one markdown block', () => {
    expect(splitTarsAnswer('plain')).toEqual([{ type: 'markdown', content: 'plain' }]);
    expect(splitTarsAnswer('  ')).toEqual([]);
  });
});

describe('getTarsPluginAnswer', () => {
  const stepAttachment = (toolCallId: string, answer?: string) =>
    ({
      type: Tools.tars_trace,
      toolCallId,
      [Tools.tars_trace]: { trace: [], step: { tool: 'cal', ok: true, answer } },
    }) as unknown as TAttachment;

  it('returns the answer of this tool call only', () => {
    const attachments = [stepAttachment('call-1', 'mine'), stepAttachment('call-2', 'other')];
    expect(getTarsPluginAnswer(attachments, 'call-1')).toBe('mine');
    expect(getTarsPluginAnswer([stepAttachment('call-1')], 'call-1')).toBeUndefined();
    expect(getTarsPluginAnswer(undefined, 'call-1')).toBeUndefined();
  });
});
