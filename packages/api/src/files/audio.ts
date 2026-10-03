import fs from 'fs';
import { Converter } from 'opencc-js/cn2t';
import { logger } from '@librechat/data-schemas';
import type {
  AudioProcessingResult,
  ServerRequest,
  AudioFileInfo,
  STTService,
  FileObject,
} from '~/types';
import { getBlockedUninspectableFileField, UninspectableFileError } from '~/protection/files';
import { getSafeErrorMetadata } from '~/utils';

let toTaiwanTraditional: ((text: string) => string) | undefined;

/**
 * A transcript in the script the speech config asks for. Transcription models
 * answer Mandarin in Simplified characters; `speech.stt.traditionalChinese`
 * converts it with Taiwan phrasing, as pwc_tars's own transcription did (OpenCC s2twp).
 */
export function convertSpeechTranscript(
  text: string,
  stt?: { traditionalChinese?: boolean } | null,
): string {
  if (!text || stt?.traditionalChinese !== true) {
    return text;
  }
  toTaiwanTraditional ??= Converter({ from: 'cn', to: 'twp' });
  return toTaiwanTraditional(text);
}

/**
 * Processes audio files using Speech-to-Text (STT) service.
 * @returns A promise that resolves to an object containing text and bytes.
 */
export async function processAudioFile({
  req,
  file,
  sttService,
  endpoint,
}: {
  req: ServerRequest;
  file: FileObject;
  sttService: STTService;
  /** The chat's endpoint; `speech.stt.endpoints` may route it to its own provider. */
  endpoint?: string | null;
}): Promise<AudioProcessingResult> {
  const uninspectableField = getBlockedUninspectableFileField(req.config?.filters, ['transcript']);
  let text: string;
  try {
    const audioBuffer = await fs.promises.readFile(file.path);
    const audioFile: AudioFileInfo = {
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
    };

    const [provider, sttSchema, allowedAddresses] = await sttService.getProviderSchema(
      req,
      endpoint,
    );
    text = convertSpeechTranscript(
      await sttService.sttRequest(
        provider,
        sttSchema,
        { audioBuffer, audioFile },
        allowedAddresses,
      ),
      req.config?.speech?.stt,
    );
  } catch (error) {
    logger.error('Error processing audio file with STT:', getSafeErrorMetadata(error));
    if (uninspectableField != null) {
      throw new UninspectableFileError(uninspectableField);
    }
    throw new Error(`Failed to process audio file: ${(error as Error).message}`);
  }

  if (text.trim().length === 0 && uninspectableField != null) {
    throw new UninspectableFileError(uninspectableField);
  }
  return {
    text,
    bytes: Buffer.byteLength(text, 'utf8'),
  };
}
