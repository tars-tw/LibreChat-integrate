import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';
import { Tools } from 'librechat-data-provider';
import type { TAttachment, TTarsTraceArtifact } from 'librechat-data-provider';
import { TarsTracePanel } from '../TarsTrace';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, options?: { count?: number }) =>
    options?.count != null ? `${key}:${options.count}` : key,
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

jest.mock('../ToolCall', () => ({
  __esModule: true,
  default: () => <div data-testid="tool-call" />,
}));

const artifact: TTarsTraceArtifact = {
  mode: 'sql',
  sql: 'SELECT count(*) FROM models',
  trace: [
    { type: 'turn', turn: 1 },
    { type: 'thinking', turn: 1, text: '先算總數' },
    {
      type: 'tool_call',
      id: 'c1',
      name: 'sql_query',
      title: 'sql_query: 計數',
      input: { sql: 'SELECT count(*) FROM models', purpose: '計數' },
      turn: 1,
    },
    {
      type: 'tool_result',
      id: 'c1',
      name: 'sql_query',
      ok: true,
      output: '| count |\n| 9 |',
      output_len_chars: 15,
      truncated: false,
      duration_ms: 42,
      summary: '1 rows',
      turn: 1,
    },
    { type: 'status', kind: 'warning', message: '結果已裁切' },
    { type: 'turn', turn: 2 },
  ],
};

const traceAttachment = (toolCallId: string): TAttachment =>
  ({
    type: Tools.tars_trace,
    messageId: 'm1',
    toolCallId,
    conversationId: 'conv',
    [Tools.tars_trace]: artifact,
  }) as TAttachment;

describe('TarsTracePanel', () => {
  it('renders nothing without a trace attachment for this call', () => {
    const { container } = render(
      <TarsTracePanel attachments={[traceAttachment('other')]} toolCallId="call-1" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('summarises the run and expands into the nested tool calls', () => {
    render(<TarsTracePanel attachments={[traceAttachment('call-1')]} toolCallId="call-1" />);

    const header = screen.getByRole('button', { expanded: false });
    expect(header).toHaveTextContent('com_ui_tars_trace_title');
    expect(header).toHaveTextContent('com_ui_tars_trace_summary_tools:1');
    expect(header).toHaveTextContent('com_ui_tars_trace_summary_turns:2');

    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('com_ui_tars_trace_tool_sql_query: 計數')).toBeInTheDocument();
    expect(screen.getByText('1 rows · 42ms')).toBeInTheDocument();
    expect(screen.getByText('結果已裁切')).toBeInTheDocument();
    expect(screen.getByText('SELECT count(*) FROM models')).toBeInTheDocument();
  });

  it('shows a tool call’s input and output on demand', () => {
    render(<TarsTracePanel attachments={[traceAttachment('call-1')]} toolCallId="call-1" />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));

    const row = screen.getByRole('button', { name: /com_ui_tars_trace_tool_sql_query/ });
    fireEvent.click(row);
    expect(screen.getByText('com_ui_tars_trace_tool_input')).toBeInTheDocument();
    expect(screen.getByText('com_ui_tars_trace_tool_output')).toBeInTheDocument();
    expect(screen.getByText('| count | | 9 |')).toBeInTheDocument();
  });
});
