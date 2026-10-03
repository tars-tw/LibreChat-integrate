import { Tools, ContentTypes } from 'librechat-data-provider';
import type { TMessage } from 'librechat-data-provider';
import { loadTarsPluginHistory, TARS_PLUGIN_HISTORY_MAX_MESSAGES } from './context';

const message = (
  messageId: string,
  parentMessageId: string | null,
  isCreatedByUser: boolean,
  body: Partial<TMessage>,
): TMessage => ({ messageId, parentMessageId, isCreatedByUser, ...body }) as TMessage;

describe('loadTarsPluginHistory', () => {
  const rows = [
    message('m1', null, true, { text: '第一個問題' }),
    message('m2', 'm1', false, {
      text: '',
      content: [
        { type: ContentTypes.THINK, think: 'hidden' },
        { type: ContentTypes.TEXT, text: '第一個回答' },
      ] as TMessage['content'],
    }),
    message('m3', 'm2', true, { text: '第二個問題' }),
    message('m3-alt', 'm2', true, { text: 'another branch' }),
    message('m4', 'm3', false, {
      content: [{ type: ContentTypes.TEXT, text: { value: '第二個回答' } }] as TMessage['content'],
    }),
  ];

  it('walks the branch above the message being answered, oldest first', async () => {
    const getMessages = jest.fn().mockResolvedValue(rows);
    await expect(
      loadTarsPluginHistory({
        conversationId: 'conv-1',
        parentMessageId: 'm4',
        userId: 'user-1',
        getMessages,
      }),
    ).resolves.toEqual([
      { role: 'user', content: '第一個問題' },
      { role: 'assistant', content: '第一個回答' },
      { role: 'user', content: '第二個問題' },
      { role: 'assistant', content: '第二個回答' },
    ]);
    expect(getMessages).toHaveBeenCalledWith({ conversationId: 'conv-1', user: 'user-1' });
  });

  it('puts an ends_turn plugin answer back in front of the model line', async () => {
    const history = await loadTarsPluginHistory({
      conversationId: 'conv-1',
      parentMessageId: 'a1',
      userId: 'user-1',
      getMessages: async () => [
        message('u1', null, true, { text: '請幫我分案' }),
        message('a1', 'u1', false, {
          content: [{ type: ContentTypes.TEXT, text: '已完成分案。' }] as TMessage['content'],
          attachments: [
            {
              type: Tools.tars_trace,
              messageId: 'a1',
              toolCallId: 'call-1',
              conversationId: 'conv-1',
              [Tools.tars_trace]: {
                trace: [],
                step: { tool: 'cal', ok: true, answer: '## 分案結果\n| 案號 |' },
              },
            },
            {
              type: Tools.tars_trace,
              messageId: 'a1',
              toolCallId: 'call-2',
              conversationId: 'conv-1',
              [Tools.tars_trace]: { trace: [], progress: '已判別 1/5' },
            },
          ] as TMessage['attachments'],
        }),
      ],
    });
    expect(history).toEqual([
      { role: 'user', content: '請幫我分案' },
      { role: 'assistant', content: '## 分案結果\n| 案號 |\n\n已完成分案。' },
    ]);
  });

  it('keeps only the most recent window', async () => {
    const long = Array.from({ length: 30 }, (_, i) =>
      message(`m${i}`, i === 0 ? null : `m${i - 1}`, i % 2 === 0, { text: `t${i}` }),
    );
    const history = await loadTarsPluginHistory({
      conversationId: 'conv-1',
      parentMessageId: 'm29',
      userId: 'user-1',
      getMessages: async () => long,
    });
    expect(history).toHaveLength(TARS_PLUGIN_HISTORY_MAX_MESSAGES);
    expect(history[0].content).toBe('t10');
    expect(history[history.length - 1].content).toBe('t29');
  });

  it('reads nothing for a new conversation', async () => {
    const getMessages = jest.fn();
    await expect(
      loadTarsPluginHistory({
        conversationId: 'new',
        parentMessageId: '00000000-0000-0000-0000-000000000000',
        userId: 'user-1',
        getMessages,
      }),
    ).resolves.toEqual([]);
    expect(getMessages).not.toHaveBeenCalled();
  });
});
