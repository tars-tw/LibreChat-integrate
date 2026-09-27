import { Tools } from 'librechat-data-provider';
import type { TTarsTraceArtifact } from 'librechat-data-provider';

/** The run a tool call belongs to, as LangChain hands it to the tool at invoke time. */
export interface TarsToolRunConfig {
  toolCall?: { id?: string };
  metadata?: { run_id?: string; thread_id?: string };
  signal?: AbortSignal;
}

/**
 * A live-only `tars_trace` attachment carrying the newest progress line of one
 * call. The fixed `file_id` makes the client upsert it in place, so the card
 * holds one line that keeps changing rather than a growing list; it is never
 * persisted — the finished call's own trace attachment replaces its meaning.
 */
export interface TarsProgressAttachment {
  type: Tools.tars_trace;
  file_id: string;
  toolCallId: string;
  messageId?: string;
  conversationId?: string;
  [Tools.tars_trace]: TTarsTraceArtifact;
}

/** Writes one attachment to the live chat stream (`createAttachmentEmitter` on the host). */
export type TarsAttachmentEmitter = (attachment: TarsProgressAttachment) => void;

/** Reports one progress line for the call `config` identifies; a no-op without a call id. */
export type TarsProgressReporter = (message: string, config?: TarsToolRunConfig) => void;

export const tarsProgressFileId = (toolCallId: string): string => `tars-progress-${toolCallId}`;

/**
 * Binds the host's attachment emitter into a progress reporter for pwc_tars
 * tools; undefined without one (a load path with no live stream). Best effort:
 * a closed stream or a failing emitter never fails the tool, and a repeated
 * line is not re-sent.
 */
export function createTarsProgressReporter(emit: TarsAttachmentEmitter): TarsProgressReporter;
export function createTarsProgressReporter(
  emit?: TarsAttachmentEmitter,
): TarsProgressReporter | undefined;
export function createTarsProgressReporter(
  emit?: TarsAttachmentEmitter,
): TarsProgressReporter | undefined {
  if (!emit) {
    return undefined;
  }
  const lastByCall = new Map<string, string>();
  return (message, config) => {
    const toolCallId = config?.toolCall?.id;
    const text = message.trim();
    if (!toolCallId || !text || lastByCall.get(toolCallId) === text) {
      return;
    }
    lastByCall.set(toolCallId, text);
    try {
      emit({
        type: Tools.tars_trace,
        file_id: tarsProgressFileId(toolCallId),
        toolCallId,
        messageId: config?.metadata?.run_id,
        conversationId: config?.metadata?.thread_id,
        [Tools.tars_trace]: { trace: [], progress: text },
      });
    } catch {
      /* progress is decoration; the call's result still arrives */
    }
  };
}
