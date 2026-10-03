import { logger } from '@librechat/data-schemas';
import type { Request, Response } from 'express';
import { isTarsSpreadsheet, verifyTarsFileSignature } from './sign';
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

/**
 * Serves one spreadsheet to pwc_tars's data tools. pwc_tars holds no
 * LibreChat session, so the signed reference is the whole authorization: it
 * names the file and its owner, expires within minutes, and only csv / xlsx /
 * xls files are ever served.
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
    const valid = verifyTarsFileSignature({
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
      if (!file || !isTarsSpreadsheet(file.filename)) {
        res.status(404).end();
        return;
      }
      const stream = await deps.openStream(req, file);
      stream.on('error', (error) => {
        logger.error('[tars-files] Stream failed', error);
        if (res.headersSent) {
          res.destroy();
          return;
        }
        res.status(500).end();
      });
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      );
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'no-store');
      stream.pipe(res);
    } catch (error) {
      logger.error('[tars-files] Could not serve a data file', error);
      if (!res.headersSent) {
        res.status(500).end();
      }
    }
  };
}
