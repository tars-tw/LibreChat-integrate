import { randomUUID } from 'node:crypto';
import { logger } from '@librechat/data-schemas';
import { FileContext } from 'librechat-data-provider';
import type { MCPFileArtifact } from '../types';
import { sanitizeFilename } from '~/utils/files';

/** The record fields of a saved MCP file; the storage strategy adds `filepath` and `source`. */
export interface MCPToolFileRecord {
  file_id: string;
  filename: string;
  type: string;
  bytes: number;
  context: FileContext.mcp_tool;
  text?: string;
}

/** Writes the bytes to the configured storage and creates the file record. */
export type PersistMCPToolFile<TFile> = (
  buffer: Buffer,
  record: MCPToolFileRecord,
) => Promise<TFile | null | undefined>;

export interface MCPToolFileTarget {
  /** The response message the files attach to. */
  messageId?: string;
  conversationId?: string;
  toolCallId?: string;
}

export type SavedMCPToolFile<TFile> = TFile & MCPToolFileTarget;

/**
 * Saves each file an MCP tool returned and resolves to its attachment, or `null` when it could
 * not be stored. One promise per file, so the caller can emit each as soon as it lands and one
 * failure never holds up the rest. A text candidate `processMCPFileOutput` did not accept is
 * skipped, so a result that bypassed it cannot save every text it carried.
 */
export function saveMCPToolFiles<TFile extends object>(
  files: readonly MCPFileArtifact[] | undefined,
  persist: PersistMCPToolFile<TFile>,
  target: MCPToolFileTarget,
): Promise<SavedMCPToolFile<TFile> | null>[] {
  return (files ?? [])
    .filter((file) => file.candidate !== true)
    .map(async (file) => {
      try {
        const saved = await persist(Buffer.from(file.data, 'base64'), {
          file_id: randomUUID(),
          filename: sanitizeFilename(file.filename),
          type: file.mimeType,
          bytes: file.bytes,
          context: FileContext.mcp_tool,
          ...(file.text ? { text: file.text } : {}),
        });
        return saved ? { ...saved, ...target } : null;
      } catch (error) {
        logger.error(`[mcp/files] Could not save "${file.filename}"`, error);
        return null;
      }
    });
}
