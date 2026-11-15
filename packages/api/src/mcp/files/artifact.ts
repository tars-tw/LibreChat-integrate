import path from 'node:path';
import { MCP_ATTACHMENT_META_KEY } from 'librechat-data-provider';
import type { AudioContent, MCPFileArtifact, ResourceContents } from '../types';

/** Key of the files an MCP tool returned on its result's artifact. */
export const MCP_FILES_ARTIFACT_KEY = 'mcp_files' as const;

const FALLBACK_MIME_TYPE = 'application/octet-stream';

const EXTENSIONS: Readonly<Record<string, string>> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'application/vnd.oasis.opendocument.presentation': 'odp',
  'application/zip': 'zip',
  'application/json': 'json',
  'text/csv': 'csv',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/html': 'html',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/flac': 'flac',
};

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** The last path segment of a resource URI, which is all a server tells us of a file's name. */
function nameFromUri(uri: string | undefined): string {
  if (!uri) {
    return '';
  }
  let pathname = uri;
  try {
    const url = new URL(uri);
    /* `file://report.csv` (two slashes) parses the name as the host. */
    pathname = url.protocol === 'file:' && url.pathname.length <= 1 ? url.hostname : url.pathname;
  } catch {
    pathname = uri.split(/[?#]/, 1)[0];
  }
  return decodeSegment(path.posix.basename(pathname)).trim();
}

/** A file name for an MCP file: the URI's own name, given an extension from its type if it has none. */
export function mcpFileName(uri: string | undefined, mimeType: string, fallback: string): string {
  const name = nameFromUri(uri) || fallback;
  if (path.extname(name)) {
    return name;
  }
  const extension = EXTENSIONS[mimeType.toLowerCase()];
  return extension ? `${name}.${extension}` : name;
}

/**
 * A resource delivered as a base64 `blob` is a file, whatever its type says. Image blobs keep
 * the image route (vision + saved as an image), so they are not files here.
 */
export function toResourceFileArtifact(resource: ResourceContents): MCPFileArtifact | undefined {
  if (!('blob' in resource) || typeof resource.blob !== 'string' || !resource.blob) {
    return undefined;
  }
  const mimeType = resource.mimeType || FALLBACK_MIME_TYPE;
  if (mimeType.toLowerCase().startsWith('image/')) {
    return undefined;
  }
  return {
    filename: mcpFileName(resource.uri, mimeType, 'mcp-file'),
    mimeType,
    data: resource.blob,
    bytes: Buffer.byteLength(resource.blob, 'base64'),
  };
}

/** A MIME type without its parameters, lowercased (`text/csv; charset=utf-8` -> `text/csv`). */
export function baseMimeType(mimeType: string | undefined): string {
  return (mimeType ?? '').split(';', 1)[0].trim().toLowerCase();
}

/**
 * A text body offered as a file. The parser cannot see `tars.mcpFiles`, so every text resource
 * with a type (or the server's attachment mark) becomes a candidate, and `processMCPFileOutput`
 * keeps only the types it lists. An untyped one (a plain `read_file`) never is.
 */
export function toTextFileArtifact(
  resource: ResourceContents,
  text: string,
): MCPFileArtifact | undefined {
  const attachment = resource._meta?.[MCP_ATTACHMENT_META_KEY] === true;
  const mimeType = baseMimeType(resource.mimeType) || (attachment ? 'text/plain' : '');
  if (!mimeType) {
    return undefined;
  }
  const buffer = Buffer.from(text, 'utf8');
  return {
    filename: mcpFileName(resource.uri, mimeType, 'mcp-file'),
    mimeType,
    data: buffer.toString('base64'),
    bytes: buffer.byteLength,
    text,
    candidate: true,
    ...(attachment ? { attachment } : {}),
  };
}

export function toAudioFileArtifact(item: AudioContent): MCPFileArtifact | undefined {
  if (typeof item.data !== 'string' || !item.data) {
    return undefined;
  }
  const mimeType = item.mimeType || FALLBACK_MIME_TYPE;
  return {
    filename: mcpFileName(undefined, mimeType, 'mcp-audio'),
    mimeType,
    data: item.data,
    bytes: Buffer.byteLength(item.data, 'base64'),
  };
}

/** The model's line for a returned file, before it is known whether the file is kept. */
export function describeMCPFile(file: MCPFileArtifact): string {
  return `Resource File: ${file.filename} (${file.mimeType}, ${file.bytes} bytes)`;
}
