import { Readable } from 'stream';
import { logger } from '@librechat/data-schemas';
import { isTarsSourceDownloadEnabled } from 'librechat-data-provider';
import type { Request, Response } from 'express';
import type { ListTarsDocuments } from './files';
import { hasValidTarsSourceSignature, TARS_SOURCE_SIGNATURE_PARAM } from './link';
import { listTarsSourceDocuments, tarsSourceStaticSegments } from './files';
import { getTarsBaseUrl, isTarsConfigured } from '~/tars/client';
import { sendTarsFileStream } from '~/tars/files/route';

/** One file read on pwc_tars's `/static`; a stall this long means pwc_tars is down, not busy. */
const FETCH_TIMEOUT_MS = 30_000;

export interface TarsSourceFileParams {
  agentId: string;
  knowledgeBaseId: string;
  documentId: string;
}

/** What the relay reads of the agent: the switch and the tools it depends on. */
export interface TarsSourceAgent {
  tools?: string[];
  tars_source_download?: boolean;
}

export interface TarsSourceFileRouteDeps {
  /** The saved agent with this id, or null when it no longer exists. */
  findAgent: (agentId: string) => Promise<TarsSourceAgent | null>;
  listDocuments?: ListTarsDocuments;
}

/**
 * `GET /api/tars/kb-files/:agentId/:knowledgeBaseId/:documentId` — relays one
 * knowledge-base original a knowledge search cited. The signature names the
 * file and the agent that offered it; the agent's 參考資料下載 switch is read
 * again on every download, so switching it off (or deleting the agent, or
 * removing its knowledge search) closes the links in past answers too. The
 * file is the one pwc_tars records for that document, and only from inside its
 * own knowledge base's upload folder.
 */
export function createTarsSourceFileHandler(deps: TarsSourceFileRouteDeps) {
  return async function sendTarsSourceFile(
    req: Request<TarsSourceFileParams>,
    res: Response,
  ): Promise<void> {
    const { agentId, knowledgeBaseId, documentId } = req.params;
    const rawSignature = req.query[TARS_SOURCE_SIGNATURE_PARAM];
    const signature = typeof rawSignature === 'string' ? rawSignature : undefined;
    if (!isTarsConfigured()) {
      res.status(404).end();
      return;
    }
    if (!hasValidTarsSourceSignature({ agentId, knowledgeBaseId, documentId }, signature)) {
      res.status(403).end();
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const agent = await deps.findAgent(agentId);
      if (!isTarsSourceDownloadEnabled(agent)) {
        res.status(403).end();
        return;
      }
      const documents = await listTarsSourceDocuments(knowledgeBaseId, deps.listDocuments);
      const document = documents.find((item) => item.id === documentId);
      const segments = tarsSourceStaticSegments(document?.file_path, knowledgeBaseId);
      if (!document || !segments) {
        res.status(404).end();
        return;
      }
      const path = segments.map((segment) => encodeURIComponent(segment)).join('/');
      const upstream = await fetch(`${getTarsBaseUrl()}/static/${path}`, {
        signal: controller.signal,
      });
      if (!upstream.ok || !upstream.body) {
        if (upstream.status !== 404) {
          logger.warn(
            `[tars-sources] pwc_tars returned ${upstream.status} for document ${documentId}`,
          );
        }
        res.status(upstream.status === 404 ? 404 : 502).end();
        return;
      }
      clearTimeout(timeout);
      const stream = Readable.fromWeb(
        upstream.body as unknown as Parameters<typeof Readable.fromWeb>[0],
      );
      sendTarsFileStream(res, stream, document.filename, '[tars-sources]');
    } catch (error) {
      logger.error(`[tars-sources] Failed to relay document ${documentId}`, error);
      if (!res.headersSent) {
        res.status(502).end();
      }
    } finally {
      clearTimeout(timeout);
    }
  };
}
