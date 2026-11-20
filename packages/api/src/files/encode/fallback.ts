import { logger } from '@librechat/data-schemas';
import {
  mergeFileConfig,
  hasPlainTextContent,
  getEndpointFileConfig,
  isNativelyReadableText,
  resolveSupportsFileParts,
} from 'librechat-data-provider';
import type { IMongoFile } from '@librechat/data-schemas';
import type { Providers } from '@librechat/agents';
import type {
  ServerRequest,
  DocumentResult,
  StrategyFunctions,
  OpenAITextDocumentBlock,
} from '~/types';
import {
  getFileStream,
  getConfiguredFileSizeLimit,
  isAttachmentObjectNotFoundError,
} from './utils';
import { extractInspectableFileText, getFileExtractionLogDetails } from '~/files/extract';
import { parseDocumentBuffer, canParseDocumentMimeType } from '~/files/documents/crud';
import { assertModelBoundContent } from '~/middleware/modelBoundContent';
import { UninspectableFileError } from '~/protection/files';
import { processTextWithTokenLimit } from '~/utils/text';
import { runGuardedEncode } from './memoryGuard';
import { countTokens } from '~/utils/tokenizer';

interface DocumentParams {
  provider: Providers;
  endpoint?: string;
}

/** Whether the endpoint refuses OpenAI `file` / `input_file` parts (`supportsFileParts: false`,
 *  e.g. vLLM), so its documents have to be sent as extracted text. */
export function usesDocumentTextFallback(
  req: ServerRequest,
  { provider, endpoint }: DocumentParams,
): boolean {
  if (!req.config?.fileConfig) {
    return false;
  }
  const fileConfig = mergeFileConfig(req.config.fileConfig);
  const endpointConfig = getEndpointFileConfig({ fileConfig, endpoint: endpoint ?? provider });
  return (
    resolveSupportsFileParts({
      endpoint: endpoint ?? provider,
      endpointProvider: provider,
      endpointConfig,
      fileConfig,
    }) === false
  );
}

function fileLabelOf(req: ServerRequest, file: IMongoFile, error?: unknown) {
  return getFileExtractionLogDetails({
    filters: req.config?.filters,
    filename: file.filename ?? 'document',
    fileId: file.file_id ?? '',
    error,
  });
}

/** Text from a stored document's bytes, or undefined when it has none; content-protection
 *  failures propagate, since an uninspectable file must not reach the model either way. */
async function extractStoredText(
  req: ServerRequest,
  file: IMongoFile,
  buffer: Buffer,
): Promise<string | undefined> {
  const mimetype = file.type ?? '';
  try {
    const extracted = await extractInspectableFileText({
      filters: req.config?.filters,
      extract: async () =>
        isNativelyReadableText(mimetype)
          ? { text: buffer.toString('utf8') }
          : parseDocumentBuffer({ buffer, mimetype, originalname: file.filename ?? 'document' }),
    });
    return extracted?.text ?? undefined;
  } catch (error) {
    if (error instanceof UninspectableFileError) {
      throw error;
    }
    const { fileLabel, errorMetadata } = fileLabelOf(req, file, error);
    logger.warn(
      `[encodeAndFormatDocuments] Text fallback could not read ${fileLabel}`,
      errorMetadata,
    );
    return undefined;
  }
}

/** Applies content protection, then the per-file token limit the text path applies
 *  (`extractFileContext`); the turn's character cap is cut first, since no admitted turn holds
 *  more, so a multi-MB extract is not tokenized only to be sliced. */
async function toTextBlock(
  req: ServerRequest,
  file: IMongoFile,
  text: string,
): Promise<OpenAITextDocumentBlock | null> {
  const { fileLabel } = fileLabelOf(req, file);
  if (!text.trim()) {
    logger.warn(`[encodeAndFormatDocuments] Text fallback found no text in ${fileLabel}`);
    return null;
  }
  const filters = req.config?.filters;
  if (filters != null) {
    assertModelBoundContent({ filters, files: [{ ...file, text }] });
  }

  const fileConfig = mergeFileConfig(req.config?.fileConfig);
  const charLimit = fileConfig.fileContextCharLimit;
  let limited = charLimit != null && charLimit > 0 ? text.slice(0, charLimit) : text;
  const tokenLimit = req.body?.fileTokenLimit ?? fileConfig.fileTokenLimit;
  if (tokenLimit != null && tokenLimit > 0) {
    const tokenLimited = await processTextWithTokenLimit({
      text: limited,
      tokenLimit,
      tokenCountFn: countTokens,
    });
    limited = tokenLimited.text;
  }

  logger.info(
    `[encodeAndFormatDocuments] Sent ${fileLabel} as text (${limited.length}/${text.length} chars): endpoint does not accept file parts`,
  );
  return { type: 'text', text: `File: "${file.filename ?? 'document'}"\n\n${limited}` };
}

/**
 * Encodes documents as `text` parts for an endpoint with `supportsFileParts: false`, never as a
 * `file` part it would reject. Text extracted at upload is reused; other files are streamed from
 * storage and parsed in memory. A document with no extractable text is left out.
 */
export async function encodeDocumentsWithTextFallback(
  req: ServerRequest,
  files: IMongoFile[],
  { provider, endpoint }: DocumentParams,
  getStrategyFunctions: (source: string) => StrategyFunctions,
): Promise<DocumentResult> {
  const result: DocumentResult = { documents: [], files: [] };
  /* Checked before any download: a type with no extractor cannot become text. */
  const readable = files.filter((file) => {
    const type = file.type ?? '';
    if (
      hasPlainTextContent(file) ||
      isNativelyReadableText(type) ||
      canParseDocumentMimeType(type)
    ) {
      return true;
    }
    logger.warn(
      `[encodeAndFormatDocuments] Text fallback skipped ${fileLabelOf(req, file).fileLabel} (${type}): no text extractor`,
    );
    return false;
  });
  if (!readable.length) {
    return result;
  }

  const encodingMethods: Record<string, StrategyFunctions> = {};
  const sizeLimit = getConfiguredFileSizeLimit(req, { provider, endpoint });
  const loaded = await Promise.allSettled(
    readable.map((file) =>
      hasPlainTextContent(file)
        ? null
        : runGuardedEncode(file.bytes ?? 0, () =>
            getFileStream(req, file, encodingMethods, getStrategyFunctions),
          ),
    ),
  );

  for (const [index, settled] of loaded.entries()) {
    const file = readable[index];
    if (settled.status === 'rejected') {
      if (isAttachmentObjectNotFoundError(settled.reason)) {
        throw settled.reason;
      }
      const { fileLabel, errorMetadata } = fileLabelOf(req, file, settled.reason);
      logger.error(`[encodeAndFormatDocuments] Could not load ${fileLabel}`, errorMetadata);
      continue;
    }

    let text = hasPlainTextContent(file) ? file.text : undefined;
    const content = settled.value?.content;
    if (text == null && content) {
      const buffer = Buffer.from(content, 'base64');
      /* Only the configured limit applies: the provider's own file-part limits (`validatePdf`)
       * govern bytes it receives, and this endpoint receives text, bounded by the parser's cap. */
      if (sizeLimit && buffer.length > sizeLimit) {
        throw new Error(
          `File size (~${(buffer.length / 1024 / 1024).toFixed(1)}MB) exceeds the configured limit for ${provider}`,
        );
      }
      text = await extractStoredText(req, file, buffer);
    }

    const block = text == null ? null : await toTextBlock(req, file, text);
    if (block) {
      result.documents.push(block);
      result.files.push({
        file_id: file.file_id,
        temp_file_id: file.temp_file_id,
        filepath: file.filepath,
        source: file.source,
        filename: file.filename,
        type: file.type,
      });
    }
  }

  return result;
}
