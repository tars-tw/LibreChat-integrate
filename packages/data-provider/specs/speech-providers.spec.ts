import { configSchema, resolveSpeechProvider, isSpeechProviderConfigured } from '../src/config';

const openai = { apiKey: 'sk', model: 'gpt-4o-mini-transcribe' };
const gemini = { apiKey: 'g', model: 'gemini-3.6-flash' };

describe('resolveSpeechProvider', () => {
  it('uses the only configured provider, ignoring routing and output settings', () => {
    const stt = { allowedAddresses: ['stt:1'], traditionalChinese: true, openai };
    expect(resolveSpeechProvider(stt)).toEqual(['openai', openai]);
    expect(isSpeechProviderConfigured(stt)).toBe(true);
  });

  it('routes a chat endpoint to its provider and falls back to the default', () => {
    const stt = { provider: 'openai', endpoints: { google: 'gemini' }, openai, gemini };
    expect(resolveSpeechProvider(stt, 'google')).toEqual(['gemini', gemini]);
    expect(resolveSpeechProvider(stt, 'openAI')).toEqual(['openai', openai]);
    expect(resolveSpeechProvider(stt)).toEqual(['openai', openai]);
    expect(isSpeechProviderConfigured(stt)).toBe(true);
  });

  it('falls back to the default when a route names an unconfigured provider', () => {
    const stt = { provider: 'openai', endpoints: { google: 'gemini' }, openai };
    expect(resolveSpeechProvider(stt, 'google')).toEqual(['openai', openai]);
  });

  it('resolves nothing for several providers without a default, or a missing default', () => {
    expect(resolveSpeechProvider({ openai, gemini })).toBeUndefined();
    expect(resolveSpeechProvider({ openai, gemini }, 'google')).toBeUndefined();
    expect(resolveSpeechProvider({ provider: 'gemini', openai })).toBeUndefined();
    expect(isSpeechProviderConfigured({ openai, gemini })).toBe(false);
    expect(isSpeechProviderConfigured(undefined)).toBe(false);
  });

  it('accepts the gemini provider and the routing fields in librechat.yaml', () => {
    const parsed = configSchema.safeParse({
      version: '1.3.13',
      speech: {
        stt: {
          traditionalChinese: true,
          provider: 'openai',
          endpoints: { google: 'gemini' },
          openai,
          gemini,
        },
      },
    });
    expect(parsed.success).toBe(true);
    const wrong = configSchema.safeParse({
      version: '1.3.13',
      speech: { stt: { provider: 'whisper', openai } },
    });
    expect(wrong.success).toBe(false);
  });
});
