import { getHelpAndFaqURL, getUserManualURL } from './manual';

const pathOf = (url: string) => new URL(url).pathname;

describe('getUserManualURL', () => {
  it('returns the Traditional Chinese manual for zh-Hant', () => {
    expect(pathOf(getUserManualURL('zh-Hant'))).toBe('/manual_zh-Hant/index.html');
  });

  it('returns the Traditional Chinese manual for every locale the UI renders as zh-Hant', () => {
    expect(pathOf(getUserManualURL('zh-TW'))).toBe('/manual_zh-Hant/index.html');
    expect(pathOf(getUserManualURL('zh-tw'))).toBe('/manual_zh-Hant/index.html');
    expect(pathOf(getUserManualURL('zh-HK'))).toBe('/manual_zh-Hant/index.html');
    expect(pathOf(getUserManualURL('zh_TW'))).toBe('/manual_zh-Hant/index.html');
  });

  it('follows the browser language for auto', () => {
    const language = jest.spyOn(navigator, 'language', 'get');
    language.mockReturnValue('zh-TW');
    expect(pathOf(getUserManualURL('auto'))).toBe('/manual_zh-Hant/index.html');
    language.mockReturnValue('en-US');
    expect(pathOf(getUserManualURL('auto'))).toBe('/manual_en/index.html');
    language.mockRestore();
  });

  it('falls back to English for every other locale', () => {
    expect(pathOf(getUserManualURL('en-US'))).toBe('/manual_en/index.html');
    expect(pathOf(getUserManualURL('zh-Hans'))).toBe('/manual_en/index.html');
    expect(pathOf(getUserManualURL('zh-CN'))).toBe('/manual_en/index.html');
    expect(pathOf(getUserManualURL('ja'))).toBe('/manual_en/index.html');
    expect(pathOf(getUserManualURL(undefined))).toBe('/manual_en/index.html');
  });
});

describe('getHelpAndFaqURL', () => {
  it('uses the bundled manual when no URL is configured', () => {
    expect(pathOf(getHelpAndFaqURL('zh-Hant', undefined))).toBe('/manual_zh-Hant/index.html');
  });

  it('treats the upstream LibreChat default and "/" as unconfigured', () => {
    expect(pathOf(getHelpAndFaqURL('en', 'https://librechat.ai'))).toBe('/manual_en/index.html');
    expect(pathOf(getHelpAndFaqURL('en', '/'))).toBe('/manual_en/index.html');
  });

  it('prefers an explicitly configured help URL', () => {
    expect(getHelpAndFaqURL('zh-Hant', 'https://help.example.com')).toBe(
      'https://help.example.com',
    );
  });
});
