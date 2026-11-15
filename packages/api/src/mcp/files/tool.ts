import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { logger } from '@librechat/data-schemas';
import { tarsConfigSchema, documentParserMimeTypes } from 'librechat-data-provider';
import type { DynamicStructuredTool } from '@librechat/agents/langchain/tools';
import type { TTarsMcpFilesConfig } from 'librechat-data-provider';
import type { MCPFileArtifact, Artifacts } from '../types';
import { MCP_FILES_ARTIFACT_KEY, baseMimeType } from './artifact';
import { parseDocument } from '~/files/documents/crud';

const DEFAULTS: TTarsMcpFilesConfig = tarsConfigSchema.parse({}).mcpFiles;

type MCPToolFunc = DynamicStructuredTool['func'];

/** The fields of a loaded tool this module reads; MCP tools carry `mcp`. */
export interface MCPFileToolCandidate {
  name?: string;
  mcp?: boolean;
  func?: MCPToolFunc;
}

/** Reads a file's text for the model, or `undefined` when its type has no reader. */
export type MCPFileTextReader = (file: MCPFileArtifact) => Promise<string | undefined>;

export interface MCPFileOutputOptions {
  /** `tars.mcpFiles` from librechat.yaml; the schema defaults when unset. */
  config?: Partial<TTarsMcpFilesConfig>;
  readText?: MCPFileTextReader;
}

const isDocument = (mimeType: string): boolean =>
  documentParserMimeTypes.some((pattern) => pattern.test(mimeType));

/** The text of a PDF / Office / OpenDocument file, through the upload path's own parsers. */
export const readMCPFileText: MCPFileTextReader = async (file) => {
  if (!isDocument(file.mimeType)) {
    return undefined;
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-file-'));
  const filePath = path.join(dir, 'file');
  try {
    const buffer = Buffer.from(file.data, 'base64');
    await fs.writeFile(filePath, buffer);
    const parsed = await parseDocument({
      file: {
        path: filePath,
        originalname: file.filename,
        mimetype: file.mimeType,
        size: buffer.byteLength,
      } as Express.Multer.File,
    });
    return parsed.text;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
};

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}\n[... truncated; ${text.length - maxChars} more characters are in the saved file]`;
}

async function readTextSafely(
  file: MCPFileArtifact,
  readText: MCPFileTextReader,
): Promise<string | undefined> {
  try {
    const text = await readText(file);
    return text?.trim() ? text : undefined;
  } catch (error) {
    logger.warn(`[mcp/files] Could not read the text of "${file.filename}"`, error);
    return undefined;
  }
}

interface ProcessedFile {
  file: MCPFileArtifact;
  note: string;
}

async function processFile(
  file: MCPFileArtifact,
  { maxBytes, maxTextChars }: TTarsMcpFilesConfig,
  readText: MCPFileTextReader,
): Promise<ProcessedFile | string> {
  if (file.bytes > maxBytes) {
    return `File "${file.filename}" (${file.bytes} bytes) exceeds the ${maxBytes}-byte limit for tool files and was not saved.`;
  }
  const saved = `File "${file.filename}" was saved and attached to your reply; the user can open or download it there.`;
  if (file.candidate) {
    const { candidate: _candidate, ...textFile } = file;
    return { file: textFile, note: saved };
  }
  const text = maxTextChars > 0 ? await readTextSafely(file, readText) : undefined;
  if (!text) {
    return { file, note: saved };
  }
  return {
    file: { ...file, text },
    note: `${saved}\nText of "${file.filename}":\n${truncate(text, maxTextChars)}`,
  };
}

/** A text candidate is a file only for a listed type or the server's attachment mark. */
function isWantedFile(file: MCPFileArtifact, textTypes: ReadonlySet<string>): boolean {
  return file.candidate !== true || file.attachment === true || textTypes.has(file.mimeType);
}

/**
 * Applies `tars.mcpFiles` to one MCP tool result: keeps the text files whose type it lists,
 * drops files over the size limit, reads documents so the model can use them this turn, and
 * tells the model where each file went. A text file's body is already in the result, so it is
 * not read again. The files left on the artifact are saved by the tool-end callback.
 */
export async function processMCPFileOutput(
  output: unknown,
  { config, readText = readMCPFileText }: MCPFileOutputOptions = {},
): Promise<unknown> {
  if (!Array.isArray(output) || output.length !== 2) {
    return output;
  }
  const [content, artifact] = output as [unknown, Artifacts];
  const files = artifact?.[MCP_FILES_ARTIFACT_KEY];
  if (!artifact || !files?.length) {
    return output;
  }
  const settings: TTarsMcpFilesConfig = { ...DEFAULTS, ...config };
  const { [MCP_FILES_ARTIFACT_KEY]: _files, ...rest } = artifact;
  if (!settings.enabled) {
    return [content, Object.keys(rest).length > 0 ? rest : undefined];
  }

  const textTypes = new Set(settings.textTypes.map(baseMimeType));
  const wanted = files.filter((file) => isWantedFile(file, textTypes));
  const processed = await Promise.all(wanted.map((file) => processFile(file, settings, readText)));
  const kept: MCPFileArtifact[] = [];
  const notes: string[] = [];
  for (const entry of processed) {
    if (typeof entry === 'string') {
      notes.push(entry);
      continue;
    }
    kept.push(entry.file);
    notes.push(entry.note);
  }

  const nextArtifact: Artifacts =
    kept.length > 0 ? { ...rest, [MCP_FILES_ARTIFACT_KEY]: kept } : rest;
  const hasArtifact = nextArtifact != null && Object.keys(nextArtifact).length > 0;
  const nextContent =
    typeof content === 'string' ? [content, ...notes].filter(Boolean).join('\n\n') : content;
  return [nextContent, hasArtifact ? nextArtifact : undefined];
}

const isMCPTool = (tool: MCPFileToolCandidate): boolean =>
  tool.mcp === true && typeof tool.func === 'function';

/**
 * Post-processes the files every loaded MCP tool returns (see {@link processMCPFileOutput}).
 * Wraps `func` like `attachWorkflowFiles`, so it holds on the event-driven path as well.
 */
export function attachMCPFileOutputs(
  tools: readonly MCPFileToolCandidate[],
  options: MCPFileOutputOptions = {},
): void {
  for (const tool of tools) {
    if (!isMCPTool(tool)) {
      continue;
    }
    const call = tool.func as MCPToolFunc;
    tool.func = async (input, runManager, runConfig) =>
      processMCPFileOutput(await call(input, runManager, runConfig), options);
  }
}
