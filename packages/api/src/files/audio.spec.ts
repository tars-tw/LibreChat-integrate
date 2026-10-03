import fs from 'fs';
import type { FileObject, ServerRequest, STTService } from '~/types';
import { processAudioFile, convertSpeechTranscript } from './audio';
import { UninspectableFileError } from '~/protection/files';

jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return { ...actual, promises: { ...actual.promises, readFile: jest.fn() } };
});

jest.mock('@librechat/data-schemas', () => ({
  logger: { error: jest.fn() },
}));

describe('processAudioFile transcript inspection coverage', () => {
  const file = {
    path: '/tmp/audio.webm',
    originalname: 'audio.webm',
    mimetype: 'audio/webm',
    size: 5,
  };

  const createRequest = (uninspectable?: 'allow' | 'block') =>
    ({
      config: {
        filters: {
          files: {
            pii: {
              fields: ['transcript'],
              uninspectable,
            },
          },
        },
      },
    }) as ServerRequest;

  const createSttService = (sttRequest: STTService['sttRequest']): STTService => ({
    getInstance: jest.fn(),
    getProviderSchema: jest.fn().mockResolvedValue(['openai', {}]),
    sttRequest,
  });

  beforeEach(() => {
    (fs.promises.readFile as jest.Mock).mockResolvedValue(Buffer.from('audio'));
  });

  it('threads the section-level allowedAddresses from getProviderSchema into sttRequest', async () => {
    const sttRequest = jest.fn().mockResolvedValue('transcribed');
    const schema = { url: 'http://stt.internal:8020' };
    const sttService: STTService = {
      getInstance: jest.fn(),
      getProviderSchema: jest.fn().mockResolvedValue(['openai', schema, ['stt.internal:8020']]),
      sttRequest,
    };
    const allowedAddressFile: FileObject = {
      path: '/tmp/a.wav',
      originalname: 'a.wav',
      mimetype: 'audio/wav',
      size: 5,
    };

    const result = await processAudioFile({
      req: {} as ServerRequest,
      file: allowedAddressFile,
      sttService,
    });

    expect(result.text).toBe('transcribed');
    expect(sttRequest).toHaveBeenCalledWith('openai', schema, expect.any(Object), [
      'stt.internal:8020',
    ]);
  });

  it('fails closed when strict transcript inspection cannot transcribe supported audio', async () => {
    const sttService = createSttService(jest.fn().mockRejectedValue(new Error('provider failed')));

    await expect(
      processAudioFile({ req: createRequest('block'), file, sttService }),
    ).rejects.toBeInstanceOf(UninspectableFileError);
  });

  it('fails closed when transcription produces no inspectable text', async () => {
    const sttService = createSttService(jest.fn().mockResolvedValue('   '));

    await expect(
      processAudioFile({ req: createRequest('block'), file, sttService }),
    ).rejects.toBeInstanceOf(UninspectableFileError);
  });

  it('returns a produced transcript for downstream inspection under strict policy', async () => {
    const sttService = createSttService(jest.fn().mockResolvedValue('inspectable transcript'));

    await expect(
      processAudioFile({ req: createRequest('block'), file, sttService }),
    ).resolves.toEqual({ text: 'inspectable transcript', bytes: 22 });
  });
});

describe('convertSpeechTranscript', () => {
  const simplified = '本季北区业绩是十六万九千元，软件信息';

  it('converts to Traditional Chinese with Taiwan phrasing when the config asks for it', () => {
    expect(convertSpeechTranscript(simplified, { traditionalChinese: true })).toBe(
      '本季北區業績是十六萬九千元，軟體資訊',
    );
  });

  it('leaves the transcript as is by default', () => {
    expect(convertSpeechTranscript(simplified)).toBe(simplified);
    expect(convertSpeechTranscript(simplified, { traditionalChinese: false })).toBe(simplified);
    expect(convertSpeechTranscript('', { traditionalChinese: true })).toBe('');
  });

  it('converts audio attachments transcribed by processAudioFile', async () => {
    (fs.promises.readFile as jest.Mock).mockResolvedValue(Buffer.from('audio'));
    const sttService: STTService = {
      getInstance: jest.fn(),
      getProviderSchema: jest.fn().mockResolvedValue(['openai', {}]),
      sttRequest: jest.fn().mockResolvedValue('这是一段语音测试'),
    };
    const req = { config: { speech: { stt: { traditionalChinese: true } } } } as ServerRequest;
    const file: FileObject = {
      path: '/tmp/a.m4a',
      originalname: 'a.m4a',
      mimetype: 'audio/mp4',
      size: 5,
    };

    await expect(processAudioFile({ req, file, sttService })).resolves.toMatchObject({
      text: '這是一段語音測試',
    });
  });
});
