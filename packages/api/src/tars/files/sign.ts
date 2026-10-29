import { createHmac, timingSafeEqual } from 'crypto';

/** Where pwc_tars downloads the spreadsheets its data tools read. */
export const TARS_FILE_ROUTE = '/api/tars/files';

/**
 * What a signed reference may fetch: `data` is pwc_tars's spreadsheet tools,
 * `workflow` the attachments a Langflow flow reads. The scope is part of the
 * signature, so a spreadsheet reference can never be replayed for a PDF.
 */
export type TarsFileScope = 'data' | 'workflow';

const SIGNATURE_CONTEXTS: Record<TarsFileScope, string> = {
  data: 'librechat-tars-data-file',
  workflow: 'librechat-tars-workflow-file',
};
/**
 * pwc_tars fetches a file while it binds the tool call, seconds after the
 * reference is signed, and caches it from then on; the window only has to
 * cover a slow first download.
 */
const REF_TTL_SECONDS = 10 * 60;

const SPREADSHEET_EXTENSIONS = new Set(['csv', 'xlsx', 'xls']);

/**
 * What Langflow turns into model input: its `IMG_FILE_TYPES` as images and its
 * `TEXT_FILE_TYPES` (pdf / docx parsed, the rest read as text). Anything else
 * a flow would silently skip, so it is never sent.
 */
const WORKFLOW_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'bmp',
  'pdf',
  'docx',
  'txt',
  'md',
  'mdx',
  'csv',
  'json',
  'yaml',
  'yml',
  'xml',
  'html',
  'htm',
  'py',
  'sh',
  'sql',
  'js',
  'ts',
  'tsx',
]);

/** A LibreChat upload the pwc_tars data tools can query. */
export interface TarsDataFile {
  /** LibreChat `file_id`. */
  id: string;
  filename: string;
}

/** What pwc_tars receives as `data_file_refs`: the path is appended to its own LibreChat origin. */
export interface TarsDataFileRef extends TarsDataFile {
  path: string;
}

export interface TarsFileSignature {
  scope?: TarsFileScope;
  fileId: string;
  userId: string;
  expires: number;
  signature: string;
}

function hasExtension(filename: string | null | undefined, extensions: Set<string>): boolean {
  if (!filename) {
    return false;
  }
  const dot = filename.lastIndexOf('.');
  return dot >= 0 && extensions.has(filename.slice(dot + 1).toLowerCase());
}

export function isTarsSpreadsheet(filename: string | null | undefined): boolean {
  return hasExtension(filename, SPREADSHEET_EXTENSIONS);
}

/** Whether a Langflow flow can read this attachment. */
export function isWorkflowAttachment(filename: string | null | undefined): boolean {
  return hasExtension(filename, WORKFLOW_EXTENSIONS);
}

/** Whether a reference signed for `scope` may serve this file. */
export function isServableInScope(
  scope: TarsFileScope,
  filename: string | null | undefined,
): boolean {
  return scope === 'workflow' ? isWorkflowAttachment(filename) : isTarsSpreadsheet(filename);
}

function sign(
  scope: TarsFileScope,
  fileId: string,
  userId: string,
  expires: number,
): string | null {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return null;
  }
  return createHmac('sha256', secret)
    .update(`${SIGNATURE_CONTEXTS[scope]}:${fileId}:${userId}:${expires}`)
    .digest('base64url');
}

/**
 * Short-lived references to the user's own files. The signature binds the file
 * to its owner and scope, so the download route can scope its lookup without a
 * session; nothing is returned when `JWT_SECRET` is unset.
 */
export function signTarsFileRefs(
  files: readonly TarsDataFile[],
  userId: string,
  scope: TarsFileScope,
  now: number = Date.now(),
): TarsDataFileRef[] {
  const expires = Math.floor(now / 1000) + REF_TTL_SECONDS;
  const refs: TarsDataFileRef[] = [];
  for (const file of files) {
    const signature = sign(scope, file.id, userId, expires);
    if (!signature) {
      return [];
    }
    const query = new URLSearchParams({ u: userId, exp: String(expires), sig: signature });
    if (scope !== 'data') {
      query.set('s', scope);
    }
    refs.push({
      id: file.id,
      filename: file.filename,
      path: `${TARS_FILE_ROUTE}/${encodeURIComponent(file.id)}?${query.toString()}`,
    });
  }
  return refs;
}

/** References for pwc_tars's spreadsheet tools. */
export function signTarsDataFileRefs(
  files: readonly TarsDataFile[],
  userId: string,
  now: number = Date.now(),
): TarsDataFileRef[] {
  return signTarsFileRefs(files, userId, 'data', now);
}

/** The `data_file_refs` context value pwc_tars's data tools and plugins take, or `''` for none. */
export function toTarsDataFileRefsContext(
  files: readonly TarsDataFile[] | null | undefined,
  userId: string | undefined,
): string {
  if (!files?.length || !userId) {
    return '';
  }
  const refs = signTarsDataFileRefs(files, userId);
  return refs.length ? JSON.stringify(refs) : '';
}

export function verifyTarsFileSignature(
  { scope = 'data', fileId, userId, expires, signature }: TarsFileSignature,
  now: number = Date.now(),
): boolean {
  if (!fileId || !userId || !Number.isSafeInteger(expires) || expires * 1000 < now) {
    return false;
  }
  if (scope !== 'data' && scope !== 'workflow') {
    return false;
  }
  const expected = sign(scope, fileId, userId, expires);
  if (!expected || !signature) {
    return false;
  }
  const given = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}
