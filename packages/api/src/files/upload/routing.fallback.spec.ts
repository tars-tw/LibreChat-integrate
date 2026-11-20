import { EToolResources } from 'librechat-data-provider';
import type { ServerRequest } from '~/types';
import { resolveEffectiveToolResource } from './routing';

describe('resolveEffectiveToolResource with supportsFileParts: false', () => {
  const requestFor = (mimetype: string): ServerRequest =>
    ({
      file: { mimetype, originalname: 'upload' },
      config: { fileConfig: { endpoints: { vLLM: { supportsFileParts: false } } } },
    }) as unknown as ServerRequest;

  const resolve = (mimetype: string, endpoint: string) =>
    resolveEffectiveToolResource({
      req: requestFor(mimetype),
      metadata: { endpoint },
      getAgent: jest.fn(),
    });

  it('extracts a PDF uploaded to vLLM as text context', async () => {
    await expect(resolve('application/pdf', 'vLLM')).resolves.toBe(EToolResources.context);
  });

  it('keeps images on vLLM and PDFs on other endpoints on the provider path', async () => {
    await expect(resolve('image/png', 'vLLM')).resolves.toBeUndefined();
    await expect(resolve('application/pdf', 'openAI')).resolves.toBeUndefined();
  });
});
