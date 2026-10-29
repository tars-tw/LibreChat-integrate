import { logger } from '@librechat/data-schemas';
import type { Request, Response } from 'express';
import type { TarsFileScope } from './sign';
import { isServableInScope, verifyTarsFileSignature } from './sign';
import { isTarsConfigured } from '~/tars/client';

/** A stored LibreChat file the route can stream. */
export interface TarsDownloadableFile {
  file_id: string;
  filename: string;
}

export interface TarsFileParams {
  fileId: string;
}

export interface TarsFileRouteDeps<TFile extends TarsDownloadableFile> {
  /** The file with this id owned by this user, or null. */
  findFile: (fileId: string, userId: string) => Promise<TFile | null>;
  /** A readable stream of the file's bytes from whichever storage holds it. */
  openStream: (req: Request<TarsFileParams>, file: TFile) => Promise<NodeJS.ReadableStream>;
}

const queryString = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Used when a stored file has no name, or one `encodeURIComponent` rejects (a lone surrogate). */
const FALLBACK_FILENAME = 'download';

/** The `Content-Disposition` of a download named `filename`. */
export function tarsAttachmentDisposition(filename: unknown): string {
  let encoded = FALLBACK_FILENAME;
  if (typeof filename === 'string' && filename) {
    try {
      encoded = encodeURIComponent(filename);
    } catch {
      encoded = FALLBACK_FILENAME;
    }
  }
  return `attachment; filename*=UTF-8''${encoded}`;
}

/** Streams a stored file as a download; a storage failure mid-stream ends the response. */
export function sendTarsFileStream(
  res: Response,
  stream: NodeJS.ReadableStream,
  filename: unknown,
  logTag: string,
): void {
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', tarsAttachmentDisposition(filename));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  pipeTarsDownload(res, stream, logTag);
}

/** Pipes a download whose headers are already set; a failure mid-stream ends the response. */
export function pipeTarsDownload(
  res: Response,
  stream: NodeJS.ReadableStream,
  logTag: string,
): void {
  stream.on('error', (error) => {
    logger.error(`${logTag} Stream failed`, error);
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.status(500).end();
  });
  /** `pipe` keeps the storage stream open when the download is cancelled mid-way. */
  res.on('close', () => {
    if (!res.writableFinished) {
      (stream as { destroy?: () => void }).destroy?.();
    }
  });
  stream.pipe(res);
}

/** `s` names the reference's scope; references without one are pwc_tars's spreadsheet refs. */
function scopeOf(value: unknown): TarsFileScope | null {
  const scope = queryString(value);
  if (!scope || scope === 'data') {
    return 'data';
  }
  return scope === 'workflow' ? scope : null;
}

/**
 * Serves one file to a service that holds no LibreChat session: pwc_tars's
 * data tools (csv / xlsx / xls) or a Langflow flow (the attachment types it
 * reads). The signed reference is the whole authorization: it names the file,
 * its owner and its scope, expires within minutes, and the scope decides which
 * file types are ever served.
 */
export function createTarsFileHandler<TFile extends TarsDownloadableFile>(
  deps: TarsFileRouteDeps<TFile>,
) {
  return async function sendTarsFile(req: Request<TarsFileParams>, res: Response): Promise<void> {
    if (!isTarsConfigured()) {
      res.status(404).end();
      return;
    }
    const { fileId } = req.params;
    const userId = queryString(req.query.u);
    const scope = scopeOf(req.query.s);
    const valid =
      scope != null &&
      verifyTarsFileSignature({
        scope,
        fileId,
        userId,
        expires: Number(queryString(req.query.exp)),
        signature: queryString(req.query.sig),
      });
    if (!valid) {
      res.status(403).end();
      return;
    }
    try {
      const file = await deps.findFile(fileId, userId);
      if (!file || !isServableInScope(scope, file.filename)) {
        res.status(404).end();
        return;
      }
      sendTarsFileStream(res, await deps.openStream(req, file), file.filename, '[tars-files]');
    } catch (error) {
      logger.error('[tars-files] Could not serve a data file', error);
      if (!res.headersSent) {
        res.status(500).end();
      }
    }
  };
}
