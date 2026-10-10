jest.mock('@librechat/data-schemas', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

import { ContentTypes } from 'librechat-data-provider';
import type { TMessageContentParts } from 'librechat-data-provider';
import {
  TARS_MESSAGE_STATUS,
  buildTarsTurnFields,
  createTarsMessage,
  createTarsConversation,
} from './mirror';

const BASE_URL = 'http://tars.test';

const buildResponse = (status: number, body: unknown): Response =>
  ({ status, ok: status >= 200 && status < 300, json: async () => body }) as Response;

describe('createTarsConversation', () => {
  afterEach(() => jest.restoreAllMocks());

  it('posts the conversation and returns the new pwc_tars id', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(buildResponse(201, { conversation: { id: 'tc-1' } }));

    const id = await createTarsConversation(
      'u1',
      { name: 'Chat', domainId: '100', modelName: 'gpt-5.5', systemInstruction: 'sys' },
      BASE_URL,
    );

    expect(id).toBe('tc-1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/api/conversation/create_conversation`);
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      name: 'Chat',
      domain_id: '100',
      model_name: 'gpt-5.5',
      system_instruction: 'sys',
      created_by: 'u1',
    });
  });

  it('returns null when pwc_tars omits the conversation id', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(201, {}));
    await expect(createTarsConversation('u1', { name: 'x' }, BASE_URL)).resolves.toBeNull();
  });
});

describe('createTarsMessage', () => {
  afterEach(() => jest.restoreAllMocks());

  it('posts query + response (so pwc_tars stores the answer)', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(201, {}));

    await createTarsMessage(
      'u1',
      { conversationId: 'tc-1', query: 'hi', response: 'hello', modelName: 'gpt-5.5' },
      BASE_URL,
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/api/message/create_message`);
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({
      conversation_id: 'tc-1',
      query: 'hi',
      response: 'hello',
      model_name: 'gpt-5.5',
      created_by: 'u1',
    });
    expect(typeof body.message).toBe('string');
    expect(body).not.toHaveProperty('id');
  });

  it('reuses the LibreChat messageId as the pwc_tars message id', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(201, {}));

    await createTarsMessage(
      'u1',
      { conversationId: 'tc-1', messageId: 'lc-msg-1', query: 'hi', response: 'hello' },
      BASE_URL,
    );

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.id).toBe('lc-msg-1');
  });

  it('sends the audit columns pwc_tars reports on', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(201, {}));

    await createTarsMessage(
      'u1',
      {
        conversationId: 'tc-1',
        query: 'hi',
        response: '',
        uploadFilename: 'a.pdf,b.xlsx',
        isWebSearch: true,
        isSqlAgent: true,
        messageTokens: 120,
        responseTokens: 30,
        status: TARS_MESSAGE_STATUS.failed,
        errorMessage: 'boom',
        ipAddr: '::ffff:10.0.0.8',
      },
      BASE_URL,
    );

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({
      response: '',
      upload_filename: 'a.pdf,b.xlsx',
      is_web_search: true,
      is_sql_agent: true,
      message_tokens: 120,
      response_tokens: 30,
      status: 2,
      error_message: 'boom',
      ip_addr: '10.0.0.8',
    });
  });

  it('defaults a plain turn to a successful row without optional columns', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(201, {}));

    await createTarsMessage('u1', { conversationId: 'tc-1', query: 'hi' }, BASE_URL);

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({
      response: '',
      status: 1,
      error_message: null,
      upload_filename: null,
      is_web_search: false,
      is_sql_agent: false,
      ip_addr: null,
    });
  });
});

describe('buildTarsTurnFields', () => {
  const toolCall = (name: string): TMessageContentParts =>
    ({
      type: ContentTypes.TOOL_CALL,
      tool_call: { id: `call-${name}`, name, args: '{}' },
    }) as TMessageContentParts;
  const text = (value: string): TMessageContentParts =>
    ({ type: ContentTypes.TEXT, text: value }) as TMessageContentParts;

  it('reads the answer, the tools used, the attachments and the tokens of a turn', () => {
    const fields = buildTarsTurnFields({
      response: {
        text: '',
        content: [
          toolCall('web_search'),
          text('第一段'),
          toolCall('tars_sql_query'),
          text('第二段'),
        ],
      },
      files: [{ filename: 'report.pdf' }, { filename: undefined }, { filename: 'data.xlsx' }],
      usage: [
        { input_tokens: 100, output_tokens: 20 },
        { input_tokens: 150, output_tokens: 40 },
      ],
    });

    expect(fields).toEqual({
      response: '第一段\n第二段',
      uploadFilename: 'report.pdf,data.xlsx',
      isWebSearch: true,
      isSqlAgent: true,
      messageTokens: 250,
      responseTokens: 60,
      status: TARS_MESSAGE_STATUS.success,
      errorMessage: null,
    });
  });

  it('prefers the message text and leaves unused tools off', () => {
    const fields = buildTarsTurnFields({
      response: { text: 'answer', content: [toolCall('tars_knowledge_search'), text('ignored')] },
    });

    expect(fields).toMatchObject({
      response: 'answer',
      uploadFilename: null,
      isWebSearch: false,
      isSqlAgent: false,
      messageTokens: 0,
      responseTokens: 0,
    });
  });

  it('marks the legacy sql_agent tool as a database query', () => {
    expect(buildTarsTurnFields({ response: { content: [toolCall('sql_agent')] } }).isSqlAgent).toBe(
      true,
    );
  });

  it.each([
    ['a stopped turn as interrupted', { unfinished: true }, TARS_MESSAGE_STATUS.interrupted, null],
    ['a failed turn with its error', { errorText: 'quota' }, TARS_MESSAGE_STATUS.failed, 'quota'],
    [
      'an error over an unfinished flag',
      { unfinished: true, errorText: 'x' },
      TARS_MESSAGE_STATUS.failed,
      'x',
    ],
  ] as const)('records %s', (_name, source, status, errorMessage) => {
    expect(buildTarsTurnFields(source)).toMatchObject({ status, errorMessage, response: '' });
  });
});
