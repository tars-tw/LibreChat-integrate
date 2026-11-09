import { logger, encryptV3, decryptV3 } from '@librechat/data-schemas';
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport';
import type { MCPOptions } from 'librechat-data-provider';
import { createHardenedOAuthFetch } from '~/mcp/oauth/hardenedFetch';
import { discardBody, readLimitedText } from '~/mcp/oauth/body';
import { isMCPDomainAllowed, isOAuthUrlAllowed } from '~/auth';

/**
 * pwc_tars `external` MCP servers protected by an OIDC provider. pwc_tars keeps the
 * definition and the assignments, but cannot hold a user's token, so LibreChat's own MCP
 * OAuth stack signs the user in and talks to the server directly: the token never leaves
 * LibreChat. Everything an admin enters here reaches `processMCPEnv`, which expands
 * `${ENV}` and `{{LIBRECHAT_*}}` for trusted YAML, so placeholders are refused both when
 * saving and when injecting (a row can also be written from pwc_tars's own UI).
 */

const DISCOVERY_PATH = '/.well-known/openid-configuration';
const DISCOVERY_TIMEOUT_MS = 10_000;
const MAX_DISCOVERY_BYTES = 256 * 1024;
const DEFAULT_SCOPE = 'openid';
const OFFLINE_SCOPE = 'offline_access';
const SECRET_AUTH_METHODS: ReadonlySet<string> = new Set([
  'client_secret_basic',
  'client_secret_post',
]);

const PLACEHOLDER_PATTERN = /\$\{|\{\{/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/;

export const TARS_MCP_AUTH_OIDC = 'oidc';

/** The operator allowlists (`mcpSettings`) every URL here is held to. */
export interface TarsOidcPolicy {
  allowedDomains?: string[] | null;
  allowedAddresses?: string[] | null;
}

/** The auth block as pwc_tars stores it: the secret sealed, the endpoints pinned at save time. */
export interface TarsOidcAuth {
  type: typeof TARS_MCP_AUTH_OIDC;
  issuer: string;
  client_id: string;
  client_secret_enc?: string;
  scope: string;
  audience?: string;
  authorization_url: string;
  token_url: string;
  jwks_uri: string;
  revocation_endpoint?: string;
  token_endpoint_auth_methods?: string[];
}

/** What discovery pins into the stored auth block. */
export type TarsOidcEndpoints = Pick<
  TarsOidcAuth,
  | 'authorization_url'
  | 'token_url'
  | 'jwks_uri'
  | 'revocation_endpoint'
  | 'token_endpoint_auth_methods'
>;

export interface TarsOidcProvider {
  endpoints: TarsOidcEndpoints;
  /** Whether the provider lists the scope that normally earns a refresh token. */
  offersOfflineAccess: boolean;
  /** `false` only when the provider states its grants and leaves refresh out. */
  allowsRefreshGrant: boolean;
}

/** The fields {@link buildTarsOidcEntry} reads off a pwc_tars server row. */
interface TarsOidcServerRow {
  id: string;
  type?: string;
  connection_config?: Record<string, unknown> | null;
}

/** Entry fields shared with the gateway entries, which the caller owns. */
export type TarsOidcEntryBase = Pick<MCPOptions, 'title' | 'description' | 'timeout' | 'chatMenu'>;

/** A refusal the admin can act on; `status` + `serverMessage` are what the proxy route relays. */
export class TarsOidcConfigError extends Error {
  readonly status = 400;
  readonly serverMessage: string;

  constructor(message: string) {
    super(message);
    this.name = 'TarsOidcConfigError';
    this.serverMessage = message;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function requireText(value: unknown, field: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) {
    throw new TarsOidcConfigError(`OIDC 設定缺少 ${field}`);
  }
  if (PLACEHOLDER_PATTERN.test(text) || CONTROL_CHAR_PATTERN.test(text)) {
    throw new TarsOidcConfigError(`OIDC 設定的 ${field} 含有不允許的字元或變數`);
  }
  return text;
}

function optionalText(value: unknown, field: string): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? requireText(value, field) : undefined;
}

/**
 * Parses a URL the token or the client secret will travel to. Plain `http` is accepted
 * only where the operator allowlisted that exact host, so a typo or a tampered discovery
 * document cannot downgrade the transport.
 */
function requireSecureUrl(value: unknown, field: string, policy: TarsOidcPolicy): string {
  const text = requireText(value, field);
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new TarsOidcConfigError(`OIDC 設定的 ${field} 不是有效的 URL`);
  }
  if (url.username || url.password || url.hash) {
    throw new TarsOidcConfigError(`OIDC 設定的 ${field} 不可包含帳號密碼或 # 片段`);
  }
  const allowlisted =
    url.protocol === 'http:' &&
    isOAuthUrlAllowed(text, policy.allowedDomains, policy.allowedAddresses);
  if (url.protocol !== 'https:' && !allowlisted) {
    throw new TarsOidcConfigError(
      `OIDC 設定的 ${field} 必須使用 https（http 僅限 mcpSettings 白名單內的位址）`,
    );
  }
  return text;
}

function toTokenAuthMethods(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const methods = value.filter(
    (method): method is string => typeof method === 'string' && SECRET_AUTH_METHODS.has(method),
  );
  return methods.length > 0 ? methods : undefined;
}

async function readDiscoveryDocument(
  url: string,
  fetchFn: FetchLike,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetchFn(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
  } catch (error) {
    logger.warn('[tars-mcp] OIDC discovery request failed', error);
    throw new TarsOidcConfigError('無法連線到 OIDC 提供者的探索端點');
  }
  if (!response.ok) {
    await discardBody(response);
    throw new TarsOidcConfigError(`OIDC 探索端點回應 ${response.status}`);
  }
  let body: string | null;
  try {
    body = await readLimitedText(response, MAX_DISCOVERY_BYTES);
  } catch (error) {
    logger.warn('[tars-mcp] OIDC discovery response could not be read', error);
    throw new TarsOidcConfigError('無法讀取 OIDC 探索文件');
  }
  if (body === null) {
    throw new TarsOidcConfigError('OIDC 探索文件過大');
  }
  let document: unknown;
  try {
    document = JSON.parse(body);
  } catch {
    document = null;
  }
  if (!isRecord(document)) {
    throw new TarsOidcConfigError('OIDC 探索文件格式錯誤');
  }
  return document;
}

/**
 * OIDC Discovery with the checks the MCP OAuth handler leaves to the caller: the document
 * must name the exact issuer it was fetched for (Discovery §4.3, the mix-up defense), and a
 * provider that lists its capabilities must include the code flow, S256 PKCE and an asymmetric
 * ID Token algorithm (omitted lists are allowed, since Discovery makes them optional). Redirects
 * are refused and private addresses are blocked by the hardened fetch unless the operator
 * allowlisted them.
 */
export async function discoverTarsOidcProvider(
  issuer: string,
  policy: TarsOidcPolicy,
  fetchFn: FetchLike = createHardenedOAuthFetch(policy),
): Promise<TarsOidcProvider> {
  requireSecureUrl(issuer, 'issuer', policy);
  if (new URL(issuer).search) {
    throw new TarsOidcConfigError('OIDC 設定的 issuer 不可包含查詢參數');
  }
  const document = await readDiscoveryDocument(
    `${issuer.replace(/\/+$/, '')}${DISCOVERY_PATH}`,
    fetchFn,
  );
  if (document.issuer !== issuer) {
    throw new TarsOidcConfigError('OIDC 探索文件的 issuer 與設定值不符');
  }
  const responseTypes = document.response_types_supported;
  if (Array.isArray(responseTypes) && !responseTypes.includes('code')) {
    throw new TarsOidcConfigError('OIDC 提供者不支援授權碼流程');
  }
  const pkceMethods = document.code_challenge_methods_supported;
  if (Array.isArray(pkceMethods) && !pkceMethods.includes('S256')) {
    throw new TarsOidcConfigError('OIDC 提供者不支援 PKCE S256');
  }
  const algorithms = document.id_token_signing_alg_values_supported;
  if (
    Array.isArray(algorithms) &&
    !algorithms.some((alg) => typeof alg === 'string' && /^(RS|PS|ES)(256|384|512)$/.test(alg))
  ) {
    throw new TarsOidcConfigError('OIDC 提供者的 ID Token 未使用支援的非對稱簽章演算法');
  }
  const revocation = optionalText(document.revocation_endpoint, 'revocation_endpoint');
  const tokenAuthMethods = toTokenAuthMethods(document.token_endpoint_auth_methods_supported);
  const scopes = document.scopes_supported;
  const grants = document.grant_types_supported;
  return {
    offersOfflineAccess: Array.isArray(scopes) && scopes.includes(OFFLINE_SCOPE),
    allowsRefreshGrant: !Array.isArray(grants) || grants.includes('refresh_token'),
    endpoints: {
      authorization_url: requireSecureUrl(
        document.authorization_endpoint,
        'authorization_endpoint',
        policy,
      ),
      token_url: requireSecureUrl(document.token_endpoint, 'token_endpoint', policy),
      jwks_uri: requireSecureUrl(document.jwks_uri, 'jwks_uri', policy),
      ...(revocation
        ? { revocation_endpoint: requireSecureUrl(revocation, 'revocation_endpoint', policy) }
        : {}),
      ...(tokenAuthMethods ? { token_endpoint_auth_methods: tokenAuthMethods } : {}),
    },
  };
}

function readOidcAuth(connectionConfig: unknown): Record<string, unknown> | null {
  const auth = isRecord(connectionConfig) ? connectionConfig.auth : null;
  return isRecord(auth) && auth.type === TARS_MCP_AUTH_OIDC ? auth : null;
}

export function isTarsOidcServer(server: {
  connection_config?: Record<string, unknown> | null;
}): boolean {
  return readOidcAuth(server.connection_config) != null;
}

/**
 * `openid` is what makes this OIDC, so it is always requested. Left blank, the scope also asks
 * for a refresh token where the provider advertises the scope for it; otherwise every access
 * token expiry would send the user back through sign-in.
 */
function normalizeScope(value: unknown, offersOfflineAccess = false): string {
  const entered = optionalText(value, 'scope');
  if (!entered) {
    return offersOfflineAccess ? `${DEFAULT_SCOPE} ${OFFLINE_SCOPE}` : DEFAULT_SCOPE;
  }
  const scopes = entered.split(/\s+/);
  return (scopes.includes(DEFAULT_SCOPE) ? scopes : [DEFAULT_SCOPE, ...scopes]).join(' ');
}

/**
 * A blank secret keeps the stored one only while the issuer is unchanged: otherwise
 * editing the issuer alone would send the existing secret to a token endpoint of the
 * editor's choosing.
 */
function sealClientSecret(
  entered: unknown,
  issuer: string,
  previous: Record<string, unknown> | null,
): string | undefined {
  const secret = optionalText(entered, 'client_secret');
  if (secret) {
    return encryptV3(secret);
  }
  const stored = typeof previous?.client_secret_enc === 'string' ? previous.client_secret_enc : '';
  if (!stored) {
    return undefined;
  }
  if (previous?.issuer !== issuer) {
    throw new TarsOidcConfigError('變更 issuer 時必須重新輸入 Client Secret');
  }
  return stored;
}

/**
 * Validates an admin's create/update payload and rewrites its OIDC auth block for storage.
 * Only the fields below survive, so a caller cannot supply pinned endpoints or a ciphertext
 * of its own; the endpoints are always this discovery's result. Non-OIDC payloads pass through.
 */
export async function sealTarsOidcInput<
  T extends { type?: string; connection_config?: Record<string, unknown> },
>(
  input: T,
  options: {
    policy?: TarsOidcPolicy;
    previous?: TarsOidcServerRow | null;
    fetchFn?: FetchLike;
  } = {},
): Promise<T> {
  const auth = readOidcAuth(input.connection_config);
  if (!auth) {
    return input;
  }
  const policy = options.policy ?? {};
  const connection = input.connection_config as Record<string, unknown>;
  const type = input.type ?? options.previous?.type;
  if (type !== 'external' || connection.transport !== 'streamable_http') {
    throw new TarsOidcConfigError('OIDC 驗證僅支援 streamable_http 類型的外部 MCP 伺服器');
  }
  if (isRecord(connection.headers) && Object.keys(connection.headers).length > 0) {
    throw new TarsOidcConfigError('OIDC 驗證的伺服器不支援自訂標頭');
  }
  const url = requireSecureUrl(connection.url, 'MCP 伺服器 URL', policy);
  if (!(await isMCPDomainAllowed({ url }, policy.allowedDomains, policy.allowedAddresses))) {
    throw new TarsOidcConfigError('MCP 伺服器 URL 不在 mcpSettings 白名單內');
  }

  const issuer = requireText(auth.issuer, 'issuer');
  const provider = await discoverTarsOidcProvider(issuer, policy, options.fetchFn);
  const clientSecretEnc = sealClientSecret(
    auth.client_secret,
    issuer,
    readOidcAuth(options.previous?.connection_config),
  );
  const audience = optionalText(auth.audience, 'audience');
  const sealed: TarsOidcAuth = {
    type: TARS_MCP_AUTH_OIDC,
    issuer,
    client_id: requireText(auth.client_id, 'client_id'),
    scope: normalizeScope(auth.scope, provider.offersOfflineAccess),
    ...provider.endpoints,
    ...(clientSecretEnc ? { client_secret_enc: clientSecretEnc } : {}),
    ...(audience ? { audience } : {}),
  };
  return {
    ...input,
    connection_config: { transport: 'streamable_http', url, auth: sealed },
  };
}

/**
 * Tools an admin opened on an OIDC server, by upstream tool name. A tool stays off until it is
 * listed here, so one the server adds later is not exposed on its own.
 */
export function tarsDirectEnabledTools(server: {
  tool_config?: Record<string, unknown> | null;
}): ReadonlySet<string> {
  const names = server.tool_config?.enabled_tools;
  return new Set(
    Array.isArray(names) ? names.filter((name): name is string => typeof name === 'string') : [],
  );
}

/** The server as the admin UI may see it: never the ciphertext, only whether a secret is set. */
export function redactTarsOidcServer<
  T extends { connection_config?: Record<string, unknown> | null },
>(server: T): T {
  const auth = readOidcAuth(server.connection_config);
  if (!auth) {
    return server;
  }
  const { client_secret_enc: sealed, client_secret: _plain, ...rest } = auth;
  return {
    ...server,
    connection_config: {
      ...server.connection_config,
      auth: { ...rest, has_client_secret: typeof sealed === 'string' && sealed !== '' },
    },
  };
}

function readStoredSecret(auth: Record<string, unknown>): string | undefined {
  if (typeof auth.client_secret_enc !== 'string' || auth.client_secret_enc === '') {
    return undefined;
  }
  return requireText(decryptV3(auth.client_secret_enc), 'client_secret');
}

/**
 * The `mcpConfig` entry of an OIDC server, or `null` when the stored row cannot be trusted.
 * Unlike a gateway entry it points at the real server and carries no gateway key or user
 * header, and it is never added to `allowedAddresses`: the operator's allowlists decide
 * whether this host is reachable. The token request stays on the endpoints pinned at save
 * time and PKCE is fixed to S256, whatever the server's own metadata claims later.
 */
export function buildTarsOidcEntry(
  server: TarsOidcServerRow,
  base: TarsOidcEntryBase,
  policy: TarsOidcPolicy = {},
): MCPOptions | null {
  const connection = server.connection_config;
  const auth = readOidcAuth(connection);
  if (!auth) {
    return null;
  }
  try {
    if (server.type !== 'external' || connection?.transport !== 'streamable_http') {
      throw new TarsOidcConfigError('OIDC 驗證僅支援 streamable_http 類型的外部 MCP 伺服器');
    }
    const clientSecret = readStoredSecret(auth);
    const audience = optionalText(auth.audience, 'audience');
    const revocation = optionalText(auth.revocation_endpoint, 'revocation_endpoint');
    const tokenAuthMethods = toTokenAuthMethods(auth.token_endpoint_auth_methods);
    return {
      type: 'streamable-http',
      url: requireSecureUrl(connection.url, 'MCP 伺服器 URL', policy),
      startup: false,
      requiresOAuth: true,
      ...base,
      oauth: {
        authorization_url: requireSecureUrl(auth.authorization_url, 'authorization_url', policy),
        token_url: requireSecureUrl(auth.token_url, 'token_url', policy),
        oidc_issuer: requireSecureUrl(auth.issuer, 'issuer', policy),
        oidc_jwks_uri: requireSecureUrl(auth.jwks_uri, 'jwks_uri', policy),
        client_id: requireText(auth.client_id, 'client_id'),
        scope: normalizeScope(auth.scope),
        grant_types_supported: ['authorization_code', 'refresh_token'],
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
        ...(clientSecret
          ? {
              client_secret: clientSecret,
              token_endpoint_auth_methods_supported: tokenAuthMethods ?? ['client_secret_basic'],
            }
          : {}),
        ...(audience ? { audience } : {}),
        ...(revocation
          ? { revocation_endpoint: requireSecureUrl(revocation, 'revocation_endpoint', policy) }
          : {}),
      },
    } as MCPOptions;
  } catch (error) {
    logger.warn(
      `[tars-mcp] Skipping OIDC server ${server.id}: ${error instanceof Error ? error.message : 'invalid configuration'}`,
    );
    return null;
  }
}

/** Admin "test": discovery must still succeed and still agree with the pinned endpoints. */
export async function testTarsOidcServer(
  server: TarsOidcServerRow,
  policy: TarsOidcPolicy = {},
  fetchFn?: FetchLike,
): Promise<Record<string, unknown>> {
  const auth = readOidcAuth(server.connection_config);
  if (!auth) {
    throw new TarsOidcConfigError('此伺服器未使用 OIDC 驗證');
  }
  const provider = await discoverTarsOidcProvider(
    requireText(auth.issuer, 'issuer'),
    policy,
    fetchFn,
  );
  const { endpoints } = provider;
  if (
    endpoints.token_url !== auth.token_url ||
    endpoints.authorization_url !== auth.authorization_url ||
    endpoints.jwks_uri !== auth.jwks_uri
  ) {
    throw new TarsOidcConfigError('OIDC 提供者的端點已變更，請重新儲存此伺服器');
  }
  const scopes = typeof auth.scope === 'string' ? auth.scope.split(/\s+/) : [];
  return {
    connected: true,
    issuer: auth.issuer,
    requires_user_login: true,
    refresh_token_expected: provider.allowsRefreshGrant && scopes.includes(OFFLINE_SCOPE),
  };
}
