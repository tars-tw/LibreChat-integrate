import { Tools } from 'librechat-data-provider';
import type { TarsProgressAttachment } from './progress';
import { createTarsProgressReporter, tarsProgressFileId } from './progress';

const config = {
  toolCall: { id: 'call-7' },
  metadata: { run_id: 'msg-1', thread_id: 'convo-1' },
};

describe('createTarsProgressReporter', () => {
  it('sends each new line as an in-place attachment for the call', () => {
    const sent: TarsProgressAttachment[] = [];
    const report = createTarsProgressReporter((attachment) => sent.push(attachment));

    report(' 目前正在處理第 1-5 列，共 20 列… ', config);
    report('目前正在處理第 1-5 列，共 20 列…', config);
    report('目前正在處理第 6-10 列，共 20 列…', config);

    expect(sent).toEqual([
      {
        type: Tools.tars_trace,
        file_id: tarsProgressFileId('call-7'),
        toolCallId: 'call-7',
        messageId: 'msg-1',
        conversationId: 'convo-1',
        [Tools.tars_trace]: { trace: [], progress: '目前正在處理第 1-5 列，共 20 列…' },
      },
      expect.objectContaining({
        file_id: tarsProgressFileId('call-7'),
        [Tools.tars_trace]: { trace: [], progress: '目前正在處理第 6-10 列，共 20 列…' },
      }),
    ]);
  });

  it('is absent on a load path with no live stream to write to', () => {
    expect(createTarsProgressReporter(undefined)).toBeUndefined();
  });

  it('stays silent without a call to attach to or a line to show, and never throws', () => {
    const emit = jest.fn(() => {
      throw new Error('stream closed');
    });
    const report = createTarsProgressReporter(emit);

    report('x');
    report('   ', config);
    expect(emit).not.toHaveBeenCalled();

    expect(() => report('x', config)).not.toThrow();
    expect(emit).toHaveBeenCalledTimes(1);
  });
});
