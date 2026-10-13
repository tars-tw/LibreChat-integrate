import { langflowSignInUrl, signOutOfLangflow } from '../langflow';

const replaceFetch = (impl: jest.Mock) =>
  Object.defineProperty(global, 'fetch', { value: impl, writable: true, configurable: true });

describe('Langflow addresses', () => {
  it('builds the sign-in address with the ticket encoded', () => {
    expect(langflowSignInUrl('a.b+c/d')).toBe(
      'http://localhost:7860/api/v1/tars/sso?ticket=a.b%2Bc%2Fd',
    );
  });

  describe('signOutOfLangflow', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      Object.defineProperty(global, 'fetch', {
        value: originalFetch,
        writable: true,
        configurable: true,
      });
    });

    it("posts to Langflow's TARS logout with its cookies, without reading the reply", () => {
      const fetchMock = jest.fn().mockResolvedValue({});
      replaceFetch(fetchMock);

      signOutOfLangflow();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toBe('http://localhost:7860/api/v1/tars/logout');
      expect(init).toMatchObject({ method: 'POST', mode: 'no-cors', credentials: 'include' });
    });

    it('never lets an unreachable Langflow break the LibreChat logout', async () => {
      replaceFetch(jest.fn().mockRejectedValue(new TypeError('Failed to fetch')));

      expect(() => signOutOfLangflow()).not.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });
});
