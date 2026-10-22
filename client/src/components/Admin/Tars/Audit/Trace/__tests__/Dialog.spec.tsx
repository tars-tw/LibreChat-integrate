import React from 'react';
import userEvent from '@testing-library/user-event';
import { render, screen, within } from '@testing-library/react';
import type { TTarsMessageTrace, TTarsTraceRow } from 'librechat-data-provider';
import { breakdownShares } from '../breakdown';
import { TraceErrorBoundary } from '../Parts';
import { summarizeTrace } from '../summary';
import TraceDialog from '../Dialog';

type QueryState = {
  data?: TTarsMessageTrace;
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  refetch?: () => void;
};

const mockShowToast = jest.fn();
const mockDownloadBlob = jest.fn();
const mockCopy = jest.fn((_text: string) => true);
const mockDownloadDocument = jest.fn();
let mockQuery: QueryState;

jest.mock('copy-to-clipboard', () => (text: string) => mockCopy(text));

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    dataService: {
      ...actual.dataService,
      downloadTarsAuditMemoryDocument: (id: string) => mockDownloadDocument(id),
    },
  };
});

jest.mock('~/data-provider', () => ({
  useTarsAuditMessageTraceQuery: () => mockQuery,
}));

jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: mockShowToast }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, options?: Record<string, string | number>) =>
    options ? `${key}:${Object.values(options).join(',')}` : key,
}));

jest.mock('~/components/Chat/Messages/Content/MarkdownLite', () => ({
  __esModule: true,
  default: ({ content }: { content: string }) => <div data-testid="markdown">{content}</div>,
}));

jest.mock('../../../Users/helpers', () => ({
  ...jest.requireActual('../../../Users/helpers'),
  downloadBlob: (...args: unknown[]) => mockDownloadBlob(...args),
}));

const at = (ms: number) => new Date(Date.UTC(2026, 8, 1, 2, 0, 0, ms)).toISOString();

const row = (id: string, event_type: string, fields: Partial<TTarsTraceRow> = {}) =>
  ({
    id,
    seq: 0,
    message_id: 'm-1',
    event_type,
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
  }) as TTarsTraceRow;

const trace: TTarsTraceRow[] = [
  row('r1', 'request', { started_at: at(0), payload: { domain_name: 'Finance brain' } }),
  row('r2', 'turn', { started_at: at(0) }),
  row('r3', 'thinking', { started_at: at(100), ended_at: at(300), payload: { text: 'hmm' } }),
  row('r4', 'tool_call', {
    tool_name: 'web_search',
    tool_use_id: 'c1',
    started_at: at(400),
    payload: { input: { query: 'flights' } },
  }),
  row('r5', 'tool_result', {
    tool_name: 'web_search',
    tool_use_id: 'c1',
    started_at: at(400),
    ended_at: at(900),
    duration_ms: 500,
    ok: false,
    payload: { output: 'rate limited' },
  }),
  row('r6', 'tool_call', {
    tool_name: 'web_search',
    tool_use_id: 'c2',
    attempt: 2,
    retry_of: 'c1',
    started_at: at(1000),
    payload: { input: { query: 'flights' } },
  }),
  row('r7', 'tool_result', {
    tool_name: 'web_search',
    tool_use_id: 'c2',
    attempt: 2,
    retry_of: 'c1',
    started_at: at(1000),
    ended_at: at(1500),
    ok: true,
    payload: { output: 'three results', sources: ['https://a.example'] },
  }),
  row('r8', 'usage', { payload: { input_tokens: 1200, output_tokens: 34 } }),
];

const data: TTarsMessageTrace = {
  message: {
    id: 'm-1',
    conversation_id: 'c-1',
    model_name: 'gpt-5.4-mini',
    created_at: null,
    ip_addr: '10.0.0.1',
    query: 'Which flights?',
    response: 'Here are the **flights**.',
    status: 1,
    error_message: null,
    response_latency: 2,
  },
  user: { id: 'u-1', username: 'ada', email: 'ada@example.com', user_groups: [] },
  trace,
  unapplied_regenerate_count: 1,
  conversation_history: [],
};

const renderDialog = () => render(<TraceDialog messageId="m-1" onClose={jest.fn()} />);

describe('TraceDialog', () => {
  beforeEach(() => {
    mockShowToast.mockClear();
    mockDownloadBlob.mockClear();
    /** A reset, not a clear: a queued `mockReturnValueOnce` must not outlive its test. */
    mockCopy.mockReset();
    mockCopy.mockImplementation(() => true);
    mockQuery = { data, isLoading: false, isError: false };
  });

  it('shows the loading state while the trace is fetched', () => {
    mockQuery = { isLoading: true, isError: false };
    renderDialog();
    expect(screen.getByText('com_ui_tars_audit_trace_loading')).toBeInTheDocument();
  });

  /** A 404 is an answer — the message is gone — not a failure to retry. */
  it('tells a removed message apart from a failed request', () => {
    mockQuery = {
      isLoading: false,
      isError: true,
      error: { response: { status: 404, data: { code: 'message_not_found', error: 'x' } } },
    };
    renderDialog();
    expect(screen.getByText('com_ui_tars_audit_trace_not_found')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  /** Each failure names its cause and its fix; only a passing fault offers a retry. */
  it.each([
    [{ status: 503, data: { code: 'secret_missing', error: 'x' } }, 'secret_missing', false],
    [
      {
        status: 502,
        data: { code: 'credentials_rejected', error: 'x', detail: 'Token is invalid' },
      },
      'credentials_rejected',
      false,
    ],
    [{ status: 403, data: { error: 'pwc_tars admin access required' } }, 'not_admin', false],
    [{ status: 401 }, 'session_expired', false],
    [{ status: 502, data: { code: 'tars_unreachable', error: 'x' } }, 'tars_unreachable', true],
    [{ status: 504, data: { code: 'tars_timeout', error: 'x' } }, 'tars_timeout', true],
    [undefined, 'network', true],
  ])('explains a %j failure as %s', async (response, kind, retryable) => {
    const user = userEvent.setup();
    const refetch = jest.fn();
    mockQuery = { isLoading: false, isError: true, error: { response }, refetch };
    renderDialog();

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(`com_ui_tars_audit_trace_err_${kind}`);
    expect(alert).toHaveTextContent(`com_ui_tars_audit_trace_err_${kind}_hint`);
    /** The copied details carry the message id and the classification for an administrator. */
    expect(alert).toHaveTextContent(`m-1`);
    expect(alert).toHaveTextContent(kind);
    const retry = within(alert).queryByRole('button', { name: 'com_ui_retry' });
    expect(retry != null).toBe(retryable);
    if (retry) {
      await user.click(retry);
      expect(refetch).toHaveBeenCalled();
    }
  });

  it('keeps pwc_tars’s own reason in the technical details', () => {
    mockQuery = {
      isLoading: false,
      isError: true,
      error: {
        response: {
          status: 502,
          data: { code: 'credentials_rejected', error: 'x', detail: 'Token is invalid' },
        },
      },
    };
    renderDialog();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'm-1 · HTTP 502 · credentials_rejected · Token is invalid',
    );
  });

  it('says so when the message has no trace rows', () => {
    mockQuery = { data: { ...data, trace: [] }, isLoading: false, isError: false };
    renderDialog();
    expect(screen.getByText('com_ui_tars_audit_trace_no_data')).toBeInTheDocument();
  });

  it('renders the run summary, the question and the stored answer', () => {
    renderDialog();
    expect(screen.getByText('ada')).toBeInTheDocument();
    expect(screen.getByText('Finance brain')).toBeInTheDocument();
    expect(
      screen.getByText('com_ui_tars_audit_trace_unapplied_regenerate_count:1'),
    ).toBeInTheDocument();
    expect(screen.getByText('Which flights?')).toBeInTheDocument();
    expect(screen.getByTestId('markdown')).toHaveTextContent('Here are the **flights**.');
    /** Two top-level calls, one failed: the retry does not hide the failure. */
    expect(screen.getByText('com_ui_tars_audit_trace_tool_calls').parentElement).toHaveTextContent(
      '2',
    );
  });

  /** Both the status strip and the answer's badge say how the run ended, in the same color. */
  it('shows a stopped run in amber and a failed one in red', () => {
    const withStatus = (status: number) => ({
      data: { ...data, message: { ...data.message, status } },
      isLoading: false,
      isError: false,
    });

    mockQuery = withStatus(3);
    const { unmount } = renderDialog();
    const stopped = screen.getAllByText('com_ui_tars_audit_trace_aborted');
    expect(stopped).toHaveLength(2);
    for (const label of stopped) {
      expect(label.closest('.text-status-warning')).not.toBeNull();
      expect(label.closest('.text-status-error')).toBeNull();
    }
    unmount();

    mockQuery = withStatus(2);
    renderDialog();
    const failed = screen.getAllByText('com_ui_tars_audit_trace_status_failed');
    expect(failed).toHaveLength(2);
    for (const label of failed) {
      expect(label.closest('.text-status-error')).not.toBeNull();
    }
  });

  it('draws the time breakdown with one segment per share the run spent time on', () => {
    renderDialog();
    const shares = breakdownShares(summarizeTrace(data)).map((share) => share.percent);
    const bar = screen.getByRole('img', { name: /com_ui_tars_audit_trace_breakdown/ });
    const segments = Array.from(bar.firstElementChild?.children ?? []);
    expect(shares.length).toBeGreaterThan(0);
    expect(segments).toHaveLength(shares.length);
    segments.forEach((segment, index) => {
      expect((segment as HTMLElement).style.width).toBe(`${shares[index]}%`);
    });
  });

  it('draws one bar per call and flags the retry', () => {
    renderDialog();
    const bars = screen.getAllByRole('button', { name: /web_search/ });
    expect(bars).toHaveLength(2);
    expect(within(bars[1]).getByText('#2')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /com_ui_tars_audit_trace_thinking/ }),
    ).toBeInTheDocument();
  });

  it('opens a bar’s paired input and output and displays stat strip', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getAllByRole('button', { name: /web_search/ })[1]);

    expect(await screen.findByText('com_ui_tars_audit_trace_tool_input')).toBeInTheDocument();
    expect(screen.getByText('com_ui_tars_audit_trace_tool_output')).toBeInTheDocument();
    expect(screen.getByText('three results')).toBeInTheDocument();
    expect(screen.getByText(/"query": "flights"/)).toBeInTheDocument();
    expect(screen.getByText('com_ui_tars_audit_trace_success')).toBeInTheDocument();
    expect(screen.getAllByText('com_ui_tars_audit_trace_turn_n:1').length).toBeGreaterThanOrEqual(
      2,
    );
    expect(screen.getByText('com_ui_tars_audit_trace_attempt_nth:2')).toBeInTheDocument();
  });

  it('highlights failed tool output and failure status in stat strip', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getAllByRole('button', { name: /web_search/ })[0]);

    expect(await screen.findByText('com_ui_tars_audit_trace_tool_input')).toBeInTheDocument();
    expect(screen.getByText('com_ui_tars_audit_trace_tool_output')).toBeInTheDocument();
    expect(screen.getByText('rate limited')).toBeInTheDocument();
    expect(screen.getByText('com_ui_tars_audit_trace_fail')).toBeInTheDocument();
    expect(screen.getAllByText('com_ui_tars_audit_trace_turn_n:1').length).toBeGreaterThanOrEqual(
      2,
    );
  });

  it('opens a model event dialog showing text without redundant turn field card', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole('button', { name: /com_ui_tars_audit_trace_thinking/ }));

    expect(await screen.findByText('hmm')).toBeInTheDocument();
    expect(screen.getAllByText('com_ui_tars_audit_trace_turn_n:1').length).toBeGreaterThanOrEqual(
      2,
    );
    expect(screen.queryByRole('heading', { name: 'turn' })).not.toBeInTheDocument();
  });

  it('downloads the plain-text report named after the message', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(
      screen.getByRole('button', { name: /com_ui_tars_audit_trace_download_trace/ }),
    );
    expect(mockDownloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'trace_m-1.txt');
  });

  it('lists each attachment under how the model read it, downloadable by its id', async () => {
    const pdf = new Blob(['%PDF']);
    mockDownloadDocument.mockResolvedValueOnce(pdf);
    const documents = [
      { id: null, file_id: 'f-pdf', filename: 'report.pdf', injected_as: 'provider' },
      { id: null, file_id: 'f-img', filename: 'photo.png', injected_as: 'image' },
      { id: null, filename: 'old.csv', injected_as: 'data_file' },
    ];
    mockQuery = {
      data: {
        ...data,
        trace: [...trace, row('r9', 'long_term_memory', { payload: { documents } })],
      },
      isLoading: false,
      isError: false,
    };
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole('button', { name: /com_ui_tars_audit_trace_references/ }));
    /** The overview lists the same files; these rows are the references section's, rendered last. */
    const inReferences = (name: string) =>
      (screen.getAllByText(name).at(-1) as HTMLElement).closest('dl') as HTMLElement;

    const pdfRow = inReferences('report.pdf');
    expect(pdfRow).toHaveTextContent('com_ui_tars_audit_trace_original_file_sent');
    await user.click(within(pdfRow).getByRole('button', { name: 'com_ui_download' }));
    expect(mockDownloadDocument).toHaveBeenCalledWith('f-pdf');
    expect(mockDownloadBlob).toHaveBeenCalledWith(pdf, 'report.pdf');

    /** A failed download names the file, the cause and the fix; the JSON reason arrives as a Blob. */
    mockDownloadDocument.mockRejectedValueOnce({
      response: {
        status: 404,
        data: new Blob([JSON.stringify({ code: 'document_not_found', error: 'x' })]),
      },
    });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await user.click(within(pdfRow).getByRole('button', { name: 'com_ui_download' }));
    expect(mockShowToast).toHaveBeenLastCalledWith({
      message:
        'com_ui_tars_audit_trace_download_failed_reason:report.pdf,com_ui_tars_audit_trace_err_document_not_found,com_ui_tars_audit_trace_err_document_not_found_hint',
      status: 'error',
    });
    errorSpy.mockRestore();
    const imageRow = inReferences('photo.png');
    expect(imageRow).toHaveTextContent('com_ui_tars_audit_trace_image_sent');
    expect(within(imageRow).getByRole('button', { name: 'com_ui_download' })).toBeInTheDocument();
    /** A file recorded without an id has nothing to download it by. */
    const csvRow = inReferences('old.csv');
    expect(within(csvRow).queryByRole('button')).toBeNull();
  });

  it('lists every attachment once with how it reached the model, this message’s uploads first', async () => {
    const user = userEvent.setup();
    const earlier = ['a', 'b', 'c', 'd'].map((name) => ({
      id: null,
      file_id: `f-${name}`,
      filename: `${name}.xlsx`,
      injected_as: 'data_file',
    }));
    mockQuery = {
      data: {
        ...data,
        trace: [
          ...trace,
          row('r10', 'request_raw', {
            payload: {
              payload: {
                upload_filename: 'brief.pdf, photo.png',
                upload_files: [
                  { file_id: 'f-brief', filename: 'brief.pdf' },
                  { file_id: 'f-img', filename: 'photo.png' },
                ],
              },
            },
          }),
          row('r11', 'long_term_memory', {
            payload: {
              documents: [
                ...earlier,
                { id: null, file_id: 'f-brief', filename: 'brief.pdf', injected_as: 'provider' },
                { id: null, file_id: 'f-img', filename: 'photo.png', injected_as: 'image' },
              ],
            },
          }),
        ],
      },
      isLoading: false,
      isError: false,
    };
    renderDialog();

    const list = screen.getByText('brief.pdf').closest('ul') as HTMLElement;
    const items = within(list).getAllByRole('listitem');
    /** Five files show; the sixth waits behind the toggle. */
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('brief.pdf'),
      expect.stringContaining('photo.png'),
      expect.stringContaining('a.xlsx'),
      expect.stringContaining('b.xlsx'),
      expect.stringContaining('c.xlsx'),
      'com_ui_tars_audit_trace_show_more:1',
    ]);
    expect(within(items[0]).getByRole('img')).toHaveAccessibleName(
      'com_ui_tars_audit_trace_original_file_sent',
    );
    expect(within(items[1]).getByRole('img')).toHaveAccessibleName(
      'com_ui_tars_audit_trace_image_sent',
    );
    expect(within(items[2]).getByRole('img')).toHaveAccessibleName(
      'com_ui_tars_audit_trace_mounted_as_file',
    );

    await user.click(within(items[0]).getByRole('button', { name: 'com_ui_download' }));
    expect(mockDownloadDocument).toHaveBeenCalledWith('f-brief');

    await user.click(
      within(list).getByRole('button', { name: 'com_ui_tars_audit_trace_show_more:1' }),
    );
    expect(within(list).getByText('d.xlsx')).toBeInTheDocument();
    expect(
      within(list).getByRole('button', { name: 'com_ui_tars_audit_trace_show_less' }),
    ).toHaveAttribute('aria-expanded', 'true');
    /** The legacy fields give way to the list. */
    expect(screen.queryByText('com_ui_tars_audit_trace_data_files')).toBeNull();
  });

  /** pwc_tars's own trace, or one from before the list, carries no long-term-memory row. */
  it('keeps the legacy file fields for a trace without the attachment list', () => {
    mockQuery = {
      data: {
        ...data,
        trace: [
          ...trace,
          row('r10', 'request_raw', { payload: { payload: { upload_filename: 'brief.pdf' } } }),
          row('r11', 'provenance', {
            payload: { data_files: ['sales.xlsx'], image_input_count: 2 },
          }),
        ],
      },
      isLoading: false,
      isError: false,
    };
    renderDialog();
    expect(screen.getByText('com_ui_tars_audit_trace_upload_file')).toBeInTheDocument();
    expect(screen.getByText('brief.pdf')).toBeInTheDocument();
    expect(screen.getByText('sales.xlsx')).toBeInTheDocument();
    expect(screen.getByText('com_ui_tars_audit_trace_image_inputs')).toBeInTheDocument();
    expect(screen.queryByText('com_ui_tars_audit_trace_attachments')).toBeNull();
  });

  it('copies the message ID when clicking copy message button', async () => {
    const user = userEvent.setup();
    renderDialog();
    const button = screen.getByRole('button', { name: /com_ui_tars_audit_trace_copy_message_id/ });
    await user.click(button);
    expect(mockCopy).toHaveBeenCalledWith('m-1');
    expect(mockShowToast).not.toHaveBeenCalled();
    /** The native CopyButton confirms by relabeling itself. */
    expect(button).toHaveAccessibleName('com_ui_copied');

    mockCopy.mockReturnValueOnce(false);
    await user.click(button);
    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'com_ui_tars_audit_trace_copy_failed',
      status: 'error',
    });
  });

  it('copies the conversation ID when clicking copy conversation button', async () => {
    const user = userEvent.setup();
    renderDialog();
    const button = screen.getByRole('button', {
      name: /com_ui_tars_audit_trace_copy_conversation_id/,
    });
    await user.click(button);
    expect(mockCopy).toHaveBeenCalledWith('c-1');
    expect(mockShowToast).not.toHaveBeenCalled();
    /** The native CopyButton confirms by relabeling itself. */
    expect(button).toHaveAccessibleName('com_ui_copied');

    mockCopy.mockReturnValueOnce(false);
    await user.click(button);
    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'com_ui_tars_audit_trace_copy_failed',
      status: 'error',
    });
  });

  it('copies the tool call JSON when clicking copy tool call JSON button in detail modal', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getAllByRole('button', { name: /web_search/ })[0]);
    /** The title is the chat's name for the call; the stored name stays beside it. */
    expect(
      screen.getByRole('heading', { name: 'com_ui_tars_trace_tool_web_search' }),
    ).toBeInTheDocument();
    expect(screen.getByText('web_search')).toBeInTheDocument();

    const copyButton = screen.getByRole('button', {
      name: /com_ui_tars_audit_trace_copy_json/,
    });
    await user.click(copyButton);

    expect(mockCopy).toHaveBeenCalled();
    const copiedText = mockCopy.mock.calls[mockCopy.mock.calls.length - 1][0];
    const parsed = JSON.parse(copiedText);
    expect(parsed.tool_name).toBe('web_search');
    expect(parsed.tool_use_id).toBe('c1');
    expect(parsed.ok).toBe(false);
    expect(mockShowToast).not.toHaveBeenCalled();

    mockCopy.mockReturnValueOnce(false);
    await user.click(copyButton);
    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'com_ui_tars_audit_trace_copy_failed',
      status: 'error',
    });
  });
});

/** A row whose payload breaks the summary: `sources` must be a list of URLs. */
const unreadable: TTarsMessageTrace = {
  ...data,
  trace: [
    ...trace,
    row('r9', 'tool_result', {
      tool_name: 'web_search',
      tool_use_id: 'c3',
      payload: { sources: 'https://a.example' as unknown as string[] },
    }),
  ],
};

describe('TraceDialog with a trace it cannot read', () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    mockShowToast.mockClear();
    mockDownloadBlob.mockClear();
    mockQuery = { data: unreadable, isLoading: false, isError: false };
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => consoleError.mockRestore());

  it('shows the error in the dialog instead of taking the page down', () => {
    renderDialog();
    expect(screen.getByRole('alert')).toHaveTextContent('com_ui_tars_audit_trace_view_error');
    expect(
      screen.getByRole('button', { name: /com_ui_tars_audit_trace_copy_message_id/ }),
    ).toBeInTheDocument();
  });

  it('says the report download failed rather than doing nothing', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(
      screen.getByRole('button', { name: /com_ui_tars_audit_trace_download_trace/ }),
    );
    expect(mockDownloadBlob).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'com_ui_tars_audit_trace_download_failed',
      status: 'error',
    });
  });
});

describe('TraceDialog when its own header cannot render', () => {
  /** The report page is the dialog's parent: nothing thrown in the dialog may reach it. */
  it('keeps the failure inside the dialog, named and closable', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const message = {
      ...data.message,
      get id(): string {
        throw new Error('broken message id');
      },
    };
    mockQuery = { data: { ...data, message }, isLoading: false, isError: false };
    expect(() => renderDialog()).not.toThrow();

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('com_ui_tars_audit_trace_err_render_hint');
    expect(alert).toHaveTextContent('m-1 · broken message id');
    expect(screen.getByRole('dialog')).toHaveAccessibleName('com_ui_tars_audit_trace_dialog_title');
    spy.mockRestore();
  });
});

describe('TraceErrorBoundary', () => {
  it('renders fallback alert on child throw without crashing the parent', () => {
    const BadChild = () => {
      throw new Error('Explosion in custom tool');
    };

    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <TraceErrorBoundary title="Partial Error">
        <BadChild />
      </TraceErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Partial Error')).toBeInTheDocument();
    expect(screen.getByText('Explosion in custom tool')).toBeInTheDocument();

    spy.mockRestore();
  });
});
