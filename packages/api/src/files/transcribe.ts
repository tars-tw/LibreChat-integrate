import axios from 'axios';
import type { AxiosRequestConfig } from 'axios';
import { applySSRFSafeAgentIfDirect } from '~/auth/agent';
import { applyAxiosProxyConfig } from '~/utils/proxy';

const DEFAULT_GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta';
/** One inline request carries the whole recording; a long one takes minutes to transcribe. */
const TRANSCRIBE_TIMEOUT_MS = 5 * 60 * 1000;
/** Room for a long verbatim transcript; a reply cut at this limit is refused, not returned. */
const MAX_OUTPUT_TOKENS = 65_536;

/** pwc_tars's `INSTRUCTION_AUDIO_TRANSCRIPTION`, so both hosts transcribe alike. */
const TRANSCRIPTION_PROMPT =
  'Generate a verbatim, word-for-word transcript of the speech in the audio. ' +
  'Output Traditional Chinese for Chinese speech and keep other languages as spoken. ' +
  'Return only the transcript without any commentary or formatting.';

/** The audio types Gemini names differently from what browsers upload. */
const GEMINI_AUDIO_MIME: Record<string, string> = {
  'audio/mpeg': 'audio/mp3',
  'audio/x-wav': 'audio/wav',
  'audio/wave': 'audio/wav',
  'audio/x-m4a': 'audio/mp4',
  'audio/m4a': 'audio/mp4',
  'audio/x-flac': 'audio/flac',
};

export interface GeminiSttConfig {
  /** API base; defaults to the public Generative Language API. */
  url?: string;
  apiKey: string;
  model: string;
}

export interface GeminiTranscriptionInput {
  config: GeminiSttConfig;
  audio: Buffer;
  mimeType: string;
  /** Section-level SSRF exemptions, as for the other STT providers. */
  allowedAddresses?: string[];
}

interface GeminiPart {
  text?: string;
  thought?: boolean;
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
}

/**
 * Transcribes audio with a Gemini model through `generateContent`: Gemini has no
 * transcription endpoint, it listens to the audio and writes the transcript. Thought
 * parts are dropped, and a reply truncated at the output limit is refused rather than
 * returned as if it were the whole recording.
 */
export async function transcribeWithGemini({
  config,
  audio,
  mimeType,
  allowedAddresses,
}: GeminiTranscriptionInput): Promise<string> {
  const base = (config.url || DEFAULT_GEMINI_URL).replace(/\/+$/, '');
  const url = `${base}/models/${encodeURIComponent(config.model)}:generateContent`;
  const body = {
    contents: [
      {
        parts: [
          { text: TRANSCRIPTION_PROMPT },
          {
            inline_data: {
              mime_type: GEMINI_AUDIO_MIME[mimeType] ?? mimeType,
              data: audio.toString('base64'),
            },
          },
        ],
      },
    ],
    generationConfig: { temperature: 0, maxOutputTokens: MAX_OUTPUT_TOKENS },
  };
  const options: AxiosRequestConfig = {
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey },
    timeout: TRANSCRIBE_TIMEOUT_MS,
  };
  applyAxiosProxyConfig(options, url);
  applySSRFSafeAgentIfDirect(options, url, allowedAddresses);

  const { data } = await axios.post<GeminiResponse>(url, body, options);
  const candidate = data?.candidates?.[0];
  if (!candidate) {
    const reason = data?.promptFeedback?.blockReason;
    throw new Error(`Gemini returned no transcript${reason ? ` (${reason})` : ''}`);
  }
  if (candidate.finishReason === 'MAX_TOKENS') {
    throw new Error('The transcript exceeded the Gemini output limit; shorten the recording');
  }
  const text = (candidate.content?.parts ?? [])
    .filter((part) => part.thought !== true && typeof part.text === 'string')
    .map((part) => part.text)
    .join('')
    .trim();
  if (!text) {
    throw new Error('Gemini returned an empty transcript');
  }
  return text;
}
