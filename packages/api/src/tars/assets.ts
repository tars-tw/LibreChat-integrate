import { logger } from '@librechat/data-schemas';
import { createHmac, timingSafeEqual } from 'crypto';
import type { Request, Response } from 'express';
import { getTarsBaseUrl, isTarsConfigured } from './client';

/** Where LibreChat relays pwc_tars generated files. */
export const TARS_ASSET_ROUTE = '/api/tars/static';

const SIGNATURE_PARAM = 'sig';
const SIGNATURE_CONTEXT = 'librechat-tars-asset';
const SIGNATURE_LENGTH = 22;
/** One static file read on pwc_tars; a stall this long means pwc_tars is down, not busy. */
const FETCH_TIMEOUT_MS = 30_000;
const CACHE_CONTROL = 'private, max-age=86400';

type AssetDisposition = 'inline' | 'attachment';

interface AssetDirectory {
  disposition: AssetDisposition;
  types: ReadonlyMap<string, string>;
}

interface ResolvedAsset {
  /** Encoded path below pwc_tars's `/static`. */
  path: string;
  filename: string;
  contentType: string;
  disposition: AssetDisposition;
}

interface TarsAssetParams {
  dir: string;
  splat: string[] | string;
}

/**
 * The pwc_tars `/static` directories LibreChat relays, each limited to the file
 * types pwc_tars generates there. The rest of `/static` — `uploads` holds the
 * knowledge-base originals — stays unreachable through LibreChat, and the
 * content type is ours rather than pwc_tars's, so nothing served from this
 * origin can render as markup.
 */
const ASSET_DIRECTORIES = new Map<string, AssetDirectory>([
  [
    'quickchart',
    {
      disposition: 'inline',
      types: new Map([
        ['png', 'image/png'],
        ['jpg', 'image/jpeg'],
        ['jpeg', 'image/jpeg'],
        ['gif', 'image/gif'],
        ['webp', 'image/webp'],
      ]),
    },
  ],
  [
    'generate_output',
    {
      disposition: 'attachment',
      types: new Map([
        ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
        ['xls', 'application/vnd.ms-excel'],
        ['csv', 'text/csv'],
        ['pdf', 'application/pdf'],
        ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
        ['pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
      ]),
    },
  ],
]);

/**
 * A pwc_tars generated-file link: absolute on whatever host pwc_tars's
 * sys_config `HOST` names, or root-relative when that is unset. A query or
 * fragment is dropped, since the relay never forwards one.
 */
const ASSET_LINK = new RegExp(
  `(?:https?://[^\\s/()<>"']+|(?<=^|[\\s(<"']))/static/(${[...ASSET_DIRECTORIES.keys()].join('|')})` +
    `/([^\\s()<>"'?#]+)(?:[?#][^\\s()<>"']*)?`,
  'g',
);

function isSafeSegment(segment: string): boolean {
  return segment !== '' && segment !== '.' && segment !== '..' && !/[\\/\0]/.test(segment);
}

function decodeSegments(path: string): string[] | null {
  try {
    return path.split('/').map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }
}

function resolveAsset(dir: string, segments: readonly string[]): ResolvedAsset | null {
  const directory = ASSET_DIRECTORIES.get(dir);
  const filename = segments[segments.length - 1] ?? '';
  const extension = filename.slice(filename.lastIndexOf('.') + 1).toLowerCase();
  const contentType = directory?.types.get(extension);
  if (!directory || !contentType || !segments.every(isSafeSegment)) {
    return null;
  }
  return {
    path: [dir, ...segments].map((segment) => encodeURIComponent(segment)).join('/'),
    filename,
    contentType,
    disposition: directory.disposition,
  };
}

/**
 * HMAC over the decoded asset path, so a relayed link names exactly one file:
 * pwc_tars's names (`chart_<unix time>_<6 hex>`) are otherwise enumerable, and
 * the relay may be reachable from networks pwc_tars itself is not.
 */
function signAsset(dir: string, segments: readonly string[]): string | null {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return null;
  }
  return createHmac('sha256', secret)
    .update(`${SIGNATURE_CONTEXT}:${dir}/${segments.join('/')}`)
    .digest('base64url')
    .slice(0, SIGNATURE_LENGTH);
}

function hasValidSignature(
  dir: string,
  segments: readonly string[],
  signature: string | undefined,
): boolean {
  const expected = signAsset(dir, segments);
  if (!expected || !signature) {
    return false;
  }
  const given = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

/**
 * Points pwc_tars's generated-file links at LibreChat's signed relay. pwc_tars
 * builds them from its sys_config `HOST`, which only works for a browser that
 * can reach that exact instance — a dev pwc_tars sharing another deployment's
 * database, an internal-only pwc_tars, or an https LibreChat all break them.
 * Anything outside the relayed directories and file types is left untouched.
 */
export function rewriteTarsAssetLinks(text: string): string {
  return text.replace(ASSET_LINK, (link: string, dir: string, path: string) => {
    const segments = decodeSegments(path);
    const signature = segments && resolveAsset(dir, segments) && signAsset(dir, segments);
    return signature ? `${TARS_ASSET_ROUTE}/${dir}/${path}?${SIGNATURE_PARAM}=${signature}` : link;
  });
}

/**
 * `GET /api/tars/static/:dir/*splat` — relays one generated file from pwc_tars.
 * The signature minted by `rewriteTarsAssetLinks` is the authorization: an
 * `<img>` cannot send the JWT, and signed links keep working in shared views.
 */
export async function sendTarsAsset(req: Request<TarsAssetParams>, res: Response): Promise<void> {
  const { dir, splat } = req.params;
  const segments = Array.isArray(splat) ? splat : String(splat ?? '').split('/');
  const asset = isTarsConfigured() ? resolveAsset(dir, segments) : null;
  if (!asset) {
    res.status(404).end();
    return;
  }
  const rawSignature = req.query[SIGNATURE_PARAM];
  const signature = typeof rawSignature === 'string' ? rawSignature : undefined;
  if (!hasValidSignature(dir, segments, signature)) {
    res.status(403).end();
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const upstream = await fetch(`${getTarsBaseUrl()}/static/${asset.path}`, {
      signal: controller.signal,
    });
    if (!upstream.ok) {
      if (upstream.status !== 404) {
        logger.warn(`[tars-assets] pwc_tars returned ${upstream.status} for ${asset.path}`);
      }
      res.status(upstream.status === 404 ? 404 : 502).end();
      return;
    }
    const body = Buffer.from(await upstream.arrayBuffer());
    res.set({
      'Content-Type': asset.contentType,
      'Content-Disposition': `${asset.disposition}; filename*=UTF-8''${encodeURIComponent(asset.filename)}`,
      'Cache-Control': CACHE_CONTROL,
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(body);
  } catch (error) {
    logger.error(`[tars-assets] Failed to relay ${asset.path}`, error);
    res.status(502).end();
  } finally {
    clearTimeout(timeout);
  }
}
