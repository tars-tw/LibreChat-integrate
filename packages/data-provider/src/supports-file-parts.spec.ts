import type {
  TurnDeliveryFile,
  TurnDeliveryRouting,
  TurnFileConsumers,
} from './resolve-llm-delivery-path';
import {
  resolveUploadLLMDeliveryPath,
  resolveTurnLLMDeliveryPath as resolveStoredTurnPath,
} from './resolve-llm-delivery-path';
import { mergeFileConfig, fileConfigSchema, getEndpointFileConfig } from './file-config';
import { EModelEndpoint } from './schemas';

function resolveTurnLLMDeliveryPath({
  file,
  consumers,
  ...routing
}: {
  file: TurnDeliveryFile;
  consumers?: TurnFileConsumers;
} & Partial<TurnDeliveryRouting>) {
  return resolveStoredTurnPath(routing, file, consumers);
}

describe('supportsFileParts config merging', () => {
  const resolveFor = (dynamic: Parameters<typeof mergeFileConfig>[0], endpoint: string) =>
    getEndpointFileConfig({ fileConfig: mergeFileConfig(dynamic), endpoint }).supportsFileParts;

  it('defaults to undefined unless configured', () => {
    expect(mergeFileConfig(undefined).supportsFileParts).toBeUndefined();
    expect(resolveFor(undefined, EModelEndpoint.openAI)).toBeUndefined();
    expect(resolveFor({ endpoints: { default: {} } }, 'vLLM')).toBeUndefined();
  });

  it('validates booleans at the top level and per endpoint', () => {
    expect(
      fileConfigSchema.safeParse({
        supportsFileParts: false,
        endpoints: { vLLM: { supportsFileParts: false }, openAI: { supportsFileParts: true } },
      }).success,
    ).toBe(true);
    expect(fileConfigSchema.safeParse({ supportsFileParts: 'no' }).success).toBe(false);
  });

  it('reaches a configured custom endpoint without affecting other endpoints', () => {
    const config = { endpoints: { vLLM: { supportsFileParts: false } } };
    expect(resolveFor(config, 'vLLM')).toBe(false);
    expect(resolveFor(config, EModelEndpoint.openAI)).toBeUndefined();
  });

  it('inherits from top level, default, and custom configs and allows per-endpoint override', () => {
    expect(resolveFor({ supportsFileParts: false }, 'vLLM')).toBe(false);
    expect(resolveFor({ endpoints: { default: { supportsFileParts: false } } }, 'vLLM')).toBe(
      false,
    );
    expect(resolveFor({ endpoints: { custom: { supportsFileParts: false } } }, 'vLLM')).toBe(false);
    expect(
      resolveFor(
        {
          supportsFileParts: false,
          endpoints: { openAI: { supportsFileParts: true } },
        },
        EModelEndpoint.openAI,
      ),
    ).toBe(true);
  });
});

describe('supportsFileParts: false routing', () => {
  it('routes PDF uploads to text on custom OpenAI-compatible endpoints like vLLM', () => {
    expect(
      resolveUploadLLMDeliveryPath({
        mimeType: 'application/pdf',
        endpoint: 'vLLM',
        endpointConfig: { supportsFileParts: false },
      }),
    ).toBe('text');
  });

  it('keeps image uploads on provider even when supportsFileParts is false', () => {
    expect(
      resolveUploadLLMDeliveryPath({
        mimeType: 'image/png',
        endpoint: 'vLLM',
        endpointConfig: { supportsFileParts: false },
      }),
    ).toBe('provider');
  });

  it('still honors explicit defaultLLMDeliveryPath overrides when supportsFileParts is false', () => {
    expect(
      resolveUploadLLMDeliveryPath({
        mimeType: 'application/pdf',
        endpoint: 'vLLM',
        endpointConfig: {
          supportsFileParts: false,
          defaultLLMDeliveryPath: { overrides: { 'application/pdf': 'none' } },
        },
      }),
    ).toBe('none');
  });

  it('does not downgrade native non-OpenAI endpoints when supportsFileParts is false globally', () => {
    const fileConfig = { endpoints: {}, supportsFileParts: false };
    expect(
      resolveUploadLLMDeliveryPath({
        mimeType: 'application/pdf',
        endpoint: 'anthropic',
        fileConfig,
      }),
    ).toBe('provider');
    expect(
      resolveUploadLLMDeliveryPath({
        mimeType: 'application/pdf',
        endpoint: 'google',
        fileConfig,
      }),
    ).toBe('provider');
    expect(
      resolveUploadLLMDeliveryPath({
        mimeType: 'application/pdf',
        endpoint: 'bedrock',
        fileConfig,
      }),
    ).toBe('provider');
    expect(
      resolveUploadLLMDeliveryPath({
        mimeType: 'application/pdf',
        endpoint: 'AnthropicProxy',
        endpointProvider: 'anthropic',
        fileConfig,
      }),
    ).toBe('provider');
  });

  it('honors supportsFileParts: false for lowercase and mixed-case OpenAI provider identifiers', () => {
    expect(
      resolveUploadLLMDeliveryPath({
        mimeType: 'application/pdf',
        endpoint: 'vLLM',
        endpointProvider: 'openai',
        endpointConfig: { supportsFileParts: false },
      }),
    ).toBe('text');
    expect(
      resolveUploadLLMDeliveryPath({
        mimeType: 'application/pdf',
        endpoint: 'OpenAI',
        endpointConfig: { supportsFileParts: false },
      }),
    ).toBe('text');
    expect(
      resolveUploadLLMDeliveryPath({
        mimeType: 'application/pdf',
        endpoint: 'AzureGateway',
        endpointProvider: 'azureopenai',
        useResponsesApi: true,
        endpointConfig: { supportsFileParts: false },
      }),
    ).toBe('text');
  });

  it('keeps provider-uploaded PDFs without reusable plain text on provider at turn time so the encoder fallback runs', () => {
    const openAiPdf: TurnDeliveryFile = {
      type: 'application/pdf',
      llmDeliveryPath: 'provider',
      metadata: { destinationChosen: false },
    };
    const vllmRouting = {
      endpoint: 'vLLM',
      endpointConfig: { supportsFileParts: false },
    };

    expect(resolveTurnLLMDeliveryPath({ file: openAiPdf, ...vllmRouting })).toBe('provider');
    expect(
      resolveTurnLLMDeliveryPath({
        file: {
          ...openAiPdf,
          text: '   \n\t  ',
        },
        ...vllmRouting,
      }),
    ).toBe('provider');
    expect(
      resolveTurnLLMDeliveryPath({
        file: {
          ...openAiPdf,
          text: '<html><body>preview only</body></html>',
          textFormat: 'html',
        },
        ...vllmRouting,
      }),
    ).toBe('provider');
    expect(
      resolveTurnLLMDeliveryPath({
        file: {
          ...openAiPdf,
          llmDeliveryPath: 'text',
          text: 'already extracted',
        },
        ...vllmRouting,
      }),
    ).toBe('text');
    expect(
      resolveTurnLLMDeliveryPath({
        file: { type: 'audio/mpeg', llmDeliveryPath: 'provider' },
        ...vllmRouting,
      }),
    ).toBe('text');
    expect(
      resolveTurnLLMDeliveryPath({
        file: openAiPdf,
        endpoint: 'vLLM',
        endpointConfig: {},
      }),
    ).toBe('provider');
    expect(
      resolveTurnLLMDeliveryPath({
        file: openAiPdf,
        endpoint: 'anthropic',
        endpointConfig: { supportsFileParts: false },
      }),
    ).toBe('provider');
    expect(
      resolveTurnLLMDeliveryPath({
        file: openAiPdf,
        endpoint: 'vLLM',
        endpointConfig: {
          supportsFileParts: false,
          defaultLLMDeliveryPath: { overrides: { 'application/pdf': 'none' } },
        },
      }),
    ).toBe('none');
  });
});
