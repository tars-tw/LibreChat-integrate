import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import { Tools } from 'librechat-data-provider';
import type { TAttachment, TTarsToolStep } from 'librechat-data-provider';
import TarsToolCall from '../TarsToolCall';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, options?: { count?: number }) =>
    options?.count != null ? `${key}:${options.count}` : key,
  useProgress: (value: number) => value,
  useExpandCollapse: (isExpanded: boolean) => ({
    style: { opacity: isExpanded ? 1 : 0 },
    ref: { current: null },
  }),
  useLazyCollapseBody: () => ({
    shouldRenderBody: true,
    mountBody: jest.fn(),
    handleTransitionEnd: jest.fn(),
  }),
}));

jest.mock('../MarkdownLite', () => ({
  __esModule: true,
  default: ({ content }: { content: string }) => <div data-testid="markdown">{content}</div>,
}));

const stepAttachment = (toolCallId: string, step: TTarsToolStep): TAttachment =>
  ({
    type: Tools.tars_trace,
    messageId: 'm1',
    toolCallId,
    conversationId: 'conv',
    [Tools.tars_trace]: { trace: [], step },
  }) as TAttachment;

const searchStep: TTarsToolStep = {
  tool: 'knowledge_search',
  ok: true,
  summary: '9 chunks',
  sources: [{ filename: 'TigerairTaiwan.pdf', chunks: 3, excerpt: 'IT200 06:35' }],
};

describe('TarsToolCall', () => {
  it('reads the streaming query into the running label', () => {
    render(
      <TarsToolCall
        name="tars_knowledge_search"
        args='{"query":"台北 成田 班'
        toolCallId="call-1"
        isSubmitting={true}
      />,
    );
    const row = screen.getByTestId('tars-tool-call');
    expect(row).toHaveTextContent('com_ui_tars_tool_knowledge_search_running');
    expect(row).toHaveTextContent('台北 成田 班');
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('ignores a step attached to another call', () => {
    render(
      <TarsToolCall
        name="tars_knowledge_search"
        args={{ query: '台北 成田 班機' }}
        toolCallId="call-1"
        attachments={[stepAttachment('other-call', { ...searchStep, summary: '1 chunks' })]}
        isSubmitting={false}
        runStepStatus="completed"
      />,
    );
    const row = screen.getByTestId('tars-tool-call');
    expect(row).toHaveTextContent('com_ui_tars_tool_knowledge_search_done');
    expect(row).not.toHaveTextContent('com_ui_tars_tool_summary_chunks');
  });

  it('shows the pwc_tars summary and source files once the step arrives', () => {
    render(
      <TarsToolCall
        name="tars_knowledge_search"
        args={{ query: '台北 成田 班機' }}
        toolCallId="call-1"
        attachments={[stepAttachment('call-1', searchStep)]}
        isSubmitting={false}
        runStepStatus="completed"
      />,
    );
    const button = screen.getByRole('button', { expanded: false });
    expect(button).toHaveTextContent('com_ui_tars_tool_knowledge_search_done');
    expect(button).toHaveTextContent(
      '台北 成田 班機 · com_ui_tars_tool_summary_chunks:9 · com_ui_tars_tool_summary_files:1',
    );

    fireEvent.click(button);
    expect(screen.getByText('com_ui_tars_tool_sources')).toBeInTheDocument();
    expect(screen.getByText('TigerairTaiwan.pdf')).toBeInTheDocument();
    expect(screen.getByText('com_ui_tars_tool_summary_chunks:3')).toBeInTheDocument();
  });

  it('shows the SQL it ran and renders a result table', () => {
    render(
      <TarsToolCall
        name="tars_sql_query"
        args={{ purpose: '各站點批次數', sql: 'SELECT oper, count(*) FROM lot GROUP BY oper' }}
        toolCallId="call-2"
        attachments={[
          stepAttachment('call-2', {
            tool: 'sql_query',
            ok: true,
            summary: '2 rows',
            output: '| oper | n |\n| --- | --- |\n| A | 3 |',
          }),
        ]}
        isSubmitting={false}
        runStepStatus="completed"
      />,
    );
    const button = screen.getByRole('button');
    expect(button).toHaveTextContent('各站點批次數 · com_ui_tars_tool_summary_rows:2');
    fireEvent.click(button);
    expect(screen.getByText('SELECT oper, count(*) FROM lot GROUP BY oper')).toBeInTheDocument();
    expect(screen.getByTestId('markdown')).toHaveTextContent('| A | 3 |');
  });

  it('labels a failed step by what it tried and shows the error', () => {
    render(
      <TarsToolCall
        name="tars_sql_query"
        args={{ purpose: 'p', sql: 'SELECT x' }}
        toolCallId="call-3"
        attachments={[
          stepAttachment('call-3', { tool: 'sql_query', ok: false, output: 'no such column: x' }),
        ]}
        isSubmitting={false}
        runStepStatus="completed"
      />,
    );
    const button = screen.getByRole('button');
    expect(button).toHaveTextContent('com_ui_tars_trace_tool_sql_query');
    expect(button).toHaveTextContent('com_ui_tool_failed');
    fireEvent.click(button);
    expect(screen.getByText('com_ui_tars_trace_tool_error')).toBeInTheDocument();
    expect(screen.getByText('no such column: x')).toBeInTheDocument();
  });

  it('shows the newest progress line while the call runs, then its outcome', () => {
    const progress = {
      type: Tools.tars_trace,
      file_id: 'tars-progress-call-5',
      toolCallId: 'call-5',
      messageId: 'm1',
      [Tools.tars_trace]: { trace: [], progress: '目前正在處理第 6-10 列，共 20 列…' },
    } as unknown as TAttachment;
    const { rerender } = render(
      <TarsToolCall
        name="tars_table_task"
        args={{ instruction: '逐列比對' }}
        toolCallId="call-5"
        attachments={[progress]}
        isSubmitting={true}
      />,
    );
    const row = screen.getByTestId('tars-tool-call');
    expect(row).toHaveTextContent('com_ui_tars_tool_table_task_running');
    expect(row).toHaveTextContent('目前正在處理第 6-10 列，共 20 列…');

    rerender(
      <TarsToolCall
        name="tars_table_task"
        args={{ instruction: '逐列比對' }}
        toolCallId="call-5"
        attachments={[
          progress,
          stepAttachment('call-5', { tool: 'run_table_task', ok: true, summary: '20 rows' }),
        ]}
        isSubmitting={false}
        runStepStatus="completed"
      />,
    );
    expect(row).toHaveTextContent('com_ui_tars_tool_table_task_done');
    expect(row).toHaveTextContent('逐列比對 · com_ui_tars_tool_summary_rows:20');
    expect(row).not.toHaveTextContent('第 6-10 列');
  });

  it('previews a generated chart', () => {
    render(
      <TarsToolCall
        name="tars_create_chart"
        args={{ instruction: '長條圖' }}
        toolCallId="call-4"
        attachments={[
          stepAttachment('call-4', {
            tool: 'create_chart',
            ok: true,
            links: [{ type: 'chart', url: '/api/tars/static/quickchart/c.png?sig=x' }],
          }),
        ]}
        isSubmitting={false}
        runStepStatus="completed"
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('img')).toHaveAttribute(
      'src',
      '/api/tars/static/quickchart/c.png?sig=x',
    );
  });
});
