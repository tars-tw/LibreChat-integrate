import { FileContext } from 'librechat-data-provider';
import type { TurnDeliveryFile, TurnFileConsumers } from 'librechat-data-provider';
import {
  resolveTurnDeliveryRouting,
  applyTurnDelivery as materializeTurnDelivery,
} from './delivery';

function applyTurnDelivery<T extends TurnDeliveryFile>(
  files: T[],
  {
    agent,
    config,
    consumers,
    attachedFileIds,
  }: {
    agent?: Parameters<typeof resolveTurnDeliveryRouting>[0]['agent'];
    config?: Parameters<typeof resolveTurnDeliveryRouting>[0]['config'];
    consumers?: TurnFileConsumers;
    attachedFileIds?: ReadonlySet<string>;
  },
) {
  return materializeTurnDelivery(files, {
    routing: agent ? resolveTurnDeliveryRouting({ agent, config }) : undefined,
    consumers,
    attachedFileIds,
  });
}

describe('applyTurnDelivery with supportsFileParts: false', () => {
  const vllmConfig = {
    fileConfig: {
      endpoints: {
        vLLM: { supportsFileParts: false },
      },
    },
  };
  const vllmAgent = { provider: 'openAI', endpoint: 'vLLM' };

  it('keeps an attached code-output PDF without extracted text on provider for encoder text fallback', () => {
    const codePdf: TurnDeliveryFile & { file_id: string; filename: string; context: FileContext } =
      {
        file_id: 'code-pdf-1',
        filename: 'generated-report.pdf',
        type: 'application/pdf',
        context: FileContext.execute_code,
      };

    const [routed] = applyTurnDelivery([codePdf], {
      agent: vllmAgent,
      config: vllmConfig,
      attachedFileIds: new Set(['code-pdf-1']),
    });

    expect(routed.llmDeliveryPath).toBe('provider');
  });

  it('routes an attached code-output PDF with plain text to text, and keeps HTML-preview/blank text on provider', () => {
    const plainTextPdf: TurnDeliveryFile & { file_id: string; context: FileContext } = {
      file_id: 'code-pdf-plain',
      type: 'application/pdf',
      context: FileContext.execute_code,
      text: 'Extracted PDF summary',
      textFormat: 'text',
    };
    const htmlPreviewPdf: TurnDeliveryFile & { file_id: string; context: FileContext } = {
      file_id: 'code-pdf-html',
      type: 'application/pdf',
      context: FileContext.execute_code,
      text: '<html><body>preview</body></html>',
      textFormat: 'html',
    };
    const whitespacePdf: TurnDeliveryFile & { file_id: string; context: FileContext } = {
      file_id: 'code-pdf-blank',
      type: 'application/pdf',
      context: FileContext.execute_code,
      text: '   \n ',
    };

    const [plainRouted, htmlRouted, blankRouted] = applyTurnDelivery(
      [plainTextPdf, htmlPreviewPdf, whitespacePdf],
      {
        agent: vllmAgent,
        config: vllmConfig,
        attachedFileIds: new Set(['code-pdf-plain', 'code-pdf-html', 'code-pdf-blank']),
      },
    );

    expect(plainRouted.llmDeliveryPath).toBe('text');
    expect(htmlRouted.llmDeliveryPath).toBe('provider');
    expect(blankRouted.llmDeliveryPath).toBe('provider');
  });

  it('keeps an OpenAI-uploaded PDF without extracted text on provider when switched to vLLM', () => {
    const openAiPdf = {
      file_id: 'openai-pdf-1',
      type: 'application/pdf',
      llmDeliveryPath: 'provider' as const,
      metadata: { destinationChosen: false },
    };

    const [routed] = applyTurnDelivery([openAiPdf], {
      agent: vllmAgent,
      config: vllmConfig,
    });

    expect(routed.llmDeliveryPath).toBe('provider');
  });
});
