import { getHelpAndFaqURL, getUserManualURL } from './manual';

const pathOf = (url: string) => new URL(url).pathname;

describe('getUserManualURL', () => {
  it('returns the Traditional Chinese manual for zh-Hant', () => {
    expect(pathOf(getUserManualURL('zh-Hant'))).toBe('/manual_zh-Hant/index.html');
  });

  it('falls back to English for every other locale', () => {
    expect(pathOf(getUserManualURL('zh-Hans'))).toBe('/manual_en/index.html');
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
