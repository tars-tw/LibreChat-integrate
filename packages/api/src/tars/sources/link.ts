import { createHmac, timingSafeEqual } from 'crypto';

/** Where LibreChat relays the knowledge-base files a knowledge search cites. */
export const TARS_SOURCE_ROUTE = '/api/tars/kb-files';

export const TARS_SOURCE_SIGNATURE_PARAM = 'sig';

const SIGNATURE_CONTEXT = 'librechat-tars-source-file';
const SIGNATURE_LENGTH = 22;

/** One cited file, named by the agent that offered it for download. */
export interface TarsSourceFileRef {
  agentId: string;
  knowledgeBaseId: string;
  documentId: string;
}

const isSafeId = (value: string): boolean => /^[\w-]{1,128}$/.test(value);

/**
 * HMAC over the whole reference, so a link names exactly one file of one
 * knowledge base for one agent: the ids are otherwise easy to collect, and the
 * relay answers without a session (a plain link cannot send the JWT).
 */
function signTarsSourceFile(ref: TarsSourceFileRef): string | null {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return null;
  }
  return createHmac('sha256', secret)
    .update(`${SIGNATURE_CONTEXT}:${ref.agentId}/${ref.knowledgeBaseId}/${ref.documentId}`)
    .digest('base64url')
    .slice(0, SIGNATURE_LENGTH);
}

/** Whether every id is plain enough to sit in a path segment unencoded. */
export function isTarsSourceFileRef(ref: TarsSourceFileRef): boolean {
  return isSafeId(ref.agentId) && isSafeId(ref.knowledgeBaseId) && isSafeId(ref.documentId);
}

export function hasValidTarsSourceSignature(
  ref: TarsSourceFileRef,
  signature: string | undefined,
): boolean {
  const expected = isTarsSourceFileRef(ref) ? signTarsSourceFile(ref) : null;
  if (!expected || !signature) {
    return false;
  }
  const given = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

/** The signed relay link for one cited file; undefined when it cannot be signed. */
export function tarsSourceFileUrl(ref: TarsSourceFileRef): string | undefined {
  const signature = isTarsSourceFileRef(ref) ? signTarsSourceFile(ref) : null;
  if (!signature) {
    return undefined;
  }
  return (
    `${TARS_SOURCE_ROUTE}/${ref.agentId}/${ref.knowledgeBaseId}/${ref.documentId}` +
    `?${TARS_SOURCE_SIGNATURE_PARAM}=${signature}`
  );
}
