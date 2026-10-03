import { createHmac, timingSafeEqual } from 'crypto';

/** Where pwc_tars downloads the spreadsheets its data tools read. */
export const TARS_FILE_ROUTE = '/api/tars/files';

const SIGNATURE_CONTEXT = 'librechat-tars-data-file';
/**
 * pwc_tars fetches a file while it binds the tool call, seconds after the
 * reference is signed, and caches it from then on; the window only has to
 * cover a slow first download.
 */
const REF_TTL_SECONDS = 10 * 60;

const SPREADSHEET_EXTENSIONS = new Set(['csv', 'xlsx', 'xls']);

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
  fileId: string;
  userId: string;
  expires: number;
  signature: string;
}

export function isTarsSpreadsheet(filename: string | null | undefined): boolean {
  if (!filename) {
    return false;
  }
  const dot = filename.lastIndexOf('.');
  return dot >= 0 && SPREADSHEET_EXTENSIONS.has(filename.slice(dot + 1).toLowerCase());
}

function sign(fileId: string, userId: string, expires: number): string | null {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return null;
  }
  return createHmac('sha256', secret)
    .update(`${SIGNATURE_CONTEXT}:${fileId}:${userId}:${expires}`)
    .digest('base64url');
}

/**
 * Short-lived references to the user's own spreadsheets. The signature binds
 * the file to its owner, so the download route can scope its lookup without a
 * session; nothing is returned when `JWT_SECRET` is unset.
 */
export function signTarsDataFileRefs(
  files: readonly TarsDataFile[],
  userId: string,
  now: number = Date.now(),
): TarsDataFileRef[] {
  const expires = Math.floor(now / 1000) + REF_TTL_SECONDS;
  const refs: TarsDataFileRef[] = [];
  for (const file of files) {
    const signature = sign(file.id, userId, expires);
    if (!signature) {
      return [];
    }
    const query = new URLSearchParams({ u: userId, exp: String(expires), sig: signature });
    refs.push({
      id: file.id,
      filename: file.filename,
      path: `${TARS_FILE_ROUTE}/${encodeURIComponent(file.id)}?${query.toString()}`,
    });
  }
  return refs;
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
  { fileId, userId, expires, signature }: TarsFileSignature,
  now: number = Date.now(),
): boolean {
  if (!fileId || !userId || !Number.isSafeInteger(expires) || expires * 1000 < now) {
    return false;
  }
  const expected = sign(fileId, userId, expires);
  if (!expected || !signature) {
    return false;
  }
  const given = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}
