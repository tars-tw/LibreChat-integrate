import { hostPortFromUrl, normalizeAddressEntry } from './allowedAddresses';

describe('hostPortFromUrl', () => {
  it('derives host:port from a URL with an explicit port', () => {
    expect(hostPortFromUrl('http://localhost:7860')).toBe('localhost:7860');
    expect(hostPortFromUrl('http://host.docker.internal:7860')).toBe('host.docker.internal:7860');
  });

  it('falls back to the protocol default port when none is given', () => {
    expect(hostPortFromUrl('http://lf.example.com')).toBe('lf.example.com:80');
    expect(hostPortFromUrl('https://lf.example.com')).toBe('lf.example.com:443');
  });

  it('keeps IPv6 hosts bracketed', () => {
    expect(hostPortFromUrl('http://[::1]:7860')).toBe('[::1]:7860');
  });

  it('returns an empty string for empty or unparseable input', () => {
    expect(hostPortFromUrl('')).toBe('');
    expect(hostPortFromUrl(undefined)).toBe('');
    expect(hostPortFromUrl(null)).toBe('');
    expect(hostPortFromUrl('not a url')).toBe('');
  });

  it('produces an entry the SSRF allowlist normalizer accepts', () => {
    const entry = hostPortFromUrl('http://localhost:7860');
    expect(normalizeAddressEntry(entry)).not.toBe('');
  });
});
