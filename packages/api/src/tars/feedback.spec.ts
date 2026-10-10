jest.mock('@librechat/data-schemas', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

import { buildTarsFeedbackSubmission, mirrorTarsMessageFeedback } from './feedback';

const BASE_URL = 'http://tars.test';

const buildResponse = (status: number, body: unknown): Response =>
  ({ status, ok: status >= 200 && status < 300, json: async () => body }) as Response;

describe('buildTarsFeedbackSubmission', () => {
  it('sends a new choice as a vote with the tag label', () => {
    expect(
      buildTarsFeedbackSubmission({ rating: 'thumbsUp', tag: 'accurate_reliable' }, null),
    ).toEqual({ is_like_hit: true, is_dislike_hit: false, message_feedback: '[準確且可靠]' });
  });

  it('appends the comment after the label', () => {
    expect(
      buildTarsFeedbackSubmission(
        { rating: 'thumbsDown', tag: 'inaccurate', text: ' 數字錯了 ' },
        undefined,
      ),
    ).toEqual({
      is_like_hit: false,
      is_dislike_hit: true,
      message_feedback: '[回答不正確] 數字錯了',
    });
  });

  it('sends a comment added to the same choice without a second vote', () => {
    expect(
      buildTarsFeedbackSubmission(
        { rating: 'thumbsDown', tag: 'other', text: '少了 2025 年資料' },
        { rating: 'thumbsDown', tag: 'other' },
      ),
    ).toEqual({
      is_like_hit: false,
      is_dislike_hit: false,
      message_feedback: '[其他問題] 少了 2025 年資料',
    });
  });

  it('votes again when the tag changes', () => {
    expect(
      buildTarsFeedbackSubmission(
        { rating: 'thumbsDown', tag: 'not_helpful' },
        { rating: 'thumbsDown', tag: 'inaccurate' },
      ),
    ).toMatchObject({ is_dislike_hit: true, message_feedback: '[缺少有用資訊]' });
  });

  it('reads a tag stored as the full tag object', () => {
    expect(
      buildTarsFeedbackSubmission(
        {
          rating: 'thumbsUp',
          tag: { key: 'attention_to_detail', label: '', direction: 'thumbsUp', icon: '' },
        },
        null,
      ),
    ).toMatchObject({ is_like_hit: true, message_feedback: '[注重細節]' });
  });

  it.each([
    ['a cleared feedback', null, { rating: 'thumbsUp', tag: 'accurate_reliable' }],
    [
      'an unchanged resave',
      { rating: 'thumbsDown', tag: 'other', text: 'x' },
      { rating: 'thumbsDown', tag: 'other', text: 'x' },
    ],
    [
      'a removed comment',
      { rating: 'thumbsDown', tag: 'other' },
      { rating: 'thumbsDown', tag: 'other', text: 'x' },
    ],
  ] as const)('sends nothing for %s', (_name, feedback, previous) => {
    expect(buildTarsFeedbackSubmission(feedback, previous)).toBeNull();
  });
});

describe('mirrorTarsMessageFeedback', () => {
  afterEach(() => jest.restoreAllMocks());

  it('posts to update_message_feedback under the linked pwc_tars conversation', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(200, {}));
    const getTarsConversationId = jest.fn().mockResolvedValue('tc-1');

    await mirrorTarsMessageFeedback(
      {
        tarsId: 'u1',
        messageId: 'lc-msg-1',
        feedback: { rating: 'thumbsDown', tag: 'inaccurate', text: '數字錯了' },
      },
      getTarsConversationId,
      BASE_URL,
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/api/message/update_message_feedback`);
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      user_id: 'u1',
      conversation_id: 'tc-1',
      message_id: 'lc-msg-1',
      is_like_hit: false,
      is_dislike_hit: true,
      message_feedback: '[回答不正確] 數字錯了',
    });
  });

  it('skips unlinked users without resolving the conversation', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const getTarsConversationId = jest.fn();

    await mirrorTarsMessageFeedback(
      { tarsId: null, messageId: 'm1', feedback: { rating: 'thumbsUp', tag: 'creative_solution' } },
      getTarsConversationId,
      BASE_URL,
    );

    expect(getTarsConversationId).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips a conversation the chat mirror never linked', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');

    await mirrorTarsMessageFeedback(
      { tarsId: 'u1', messageId: 'm1', feedback: { rating: 'thumbsUp', tag: 'creative_solution' } },
      async () => undefined,
      BASE_URL,
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('swallows pwc_tars failures', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(buildResponse(500, { error: 'boom' }));

    await expect(
      mirrorTarsMessageFeedback(
        {
          tarsId: 'u1',
          messageId: 'm1',
          feedback: { rating: 'thumbsUp', tag: 'creative_solution' },
        },
        async () => 'tc-1',
        BASE_URL,
      ),
    ).resolves.toBeUndefined();
  });
});
