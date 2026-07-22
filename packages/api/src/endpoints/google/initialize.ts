import path from 'path';
import { Providers } from '@librechat/agents';
import { ErrorTypes, EModelEndpoint, AuthKeys } from 'librechat-data-provider';
import type {
  BaseInitializeParams,
  InitializeResultBase,
  GoogleConfigOptions,
  GoogleCredentials,
} from '~/types';
import { isEnabled, mergeHeaders, resolveHeaders, loadServiceKey, isNoUserKeyError } from '~/utils';
import { getTarsProviderApiKey, resolveTarsProviderKey, isExpiredKeyCoveredByTars } from '~/tars';
import { getGoogleConfig } from './llm';

/**
 * Initializes Google/Vertex AI endpoint configuration.
 * Supports both API key authentication and service account credentials.
 *
 * @param params - Configuration parameters
 * @returns Promise resolving to Google configuration options
 * @throws Error if no valid credentials are provided
 */
export async function initializeGoogle({
  req,
  endpoint,
  model_parameters,
  db,
}: BaseInitializeParams): Promise<InitializeResultBase> {
  const appConfig = req.config;
  const { GOOGLE_REVERSE_PROXY, GOOGLE_AUTH_HEADER, PROXY } = process.env;
  const isVertexEndpoint = endpoint === Providers.VERTEXAI;
  /** sys_config-managed key overrides env; the Vertex path never consults pwc_tars. */
  const GOOGLE_KEY = isVertexEndpoint
    ? process.env.GOOGLE_KEY
    : await resolveTarsProviderKey(process.env.GOOGLE_KEY, EModelEndpoint.google);
  const isUserProvided = GOOGLE_KEY === 'user_provided';
  const useUserProvidedGoogleKey = !isVertexEndpoint && isUserProvided;
  const { key: expiresAt } = req.body;

  let userKey = null;
  let tarsFallbackKey: string | undefined;
  if (useUserProvidedGoogleKey) {
    /** An expired personal key is ignored when an active sys_config key
     *  covers the provider — the fallback below then supplies it. */
    const expiredKeyCovered = expiresAt
      ? await isExpiredKeyCoveredByTars(expiresAt, EModelEndpoint.google)
      : false;
    if (!expiredKeyCovered && req.user?.id) {
      try {
        userKey = await db.getUserKey({ userId: req.user.id, name: EModelEndpoint.google });
      } catch (error) {
        /** No stored personal key is a soft miss — sys_config may cover it below. */
        if (!isNoUserKeyError(error)) {
          throw error;
        }
        userKey = null;
      }
    }
    if (userKey == null) {
      tarsFallbackKey = await getTarsProviderApiKey(EModelEndpoint.google);
      if (!tarsFallbackKey) {
        throw new Error(JSON.stringify({ type: ErrorTypes.NO_USER_KEY }));
      }
    }
  }
  const useUserKey = useUserProvidedGoogleKey && userKey != null;
  const effectiveGoogleKey = tarsFallbackKey ?? GOOGLE_KEY;

  let serviceKey: Record<string, unknown> = {};

  /** Check if GOOGLE_KEY is provided at all (including 'user_provided') */
  const isGoogleKeyProvided =
    !isVertexEndpoint && ((effectiveGoogleKey && effectiveGoogleKey.trim() !== '') || useUserKey);

  if ((isVertexEndpoint || !isGoogleKeyProvided) && loadServiceKey) {
    /** Only attempt to load service key if GOOGLE_KEY is not provided */
    try {
      const serviceKeyPath =
        process.env.GOOGLE_SERVICE_KEY_FILE || path.join(process.cwd(), 'api', 'data', 'auth.json');
      const loadedKey = await loadServiceKey(serviceKeyPath);
      if (loadedKey) {
        serviceKey = loadedKey;
      }
    } catch {
      // Service key loading failed, but that's okay if not required
      serviceKey = {};
    }
  }

  const credentials: GoogleCredentials = useUserKey
    ? (userKey as GoogleCredentials)
    : {
        [AuthKeys.GOOGLE_SERVICE_KEY]: serviceKey,
        ...(!isVertexEndpoint && { [AuthKeys.GOOGLE_API_KEY]: effectiveGoogleKey }),
      };

  let clientOptions: GoogleConfigOptions = {};

  /** @type {undefined | TBaseEndpoint} */
  const allConfig = appConfig?.endpoints?.all;
  /** @type {undefined | TBaseEndpoint} */
  const googleConfig = appConfig?.endpoints?.[EModelEndpoint.google];

  if (googleConfig) {
    clientOptions.streamRate = googleConfig.streamRate;
    clientOptions.titleModel = googleConfig.titleModel;
  }

  if (allConfig) {
    clientOptions.streamRate = allConfig.streamRate;
  }

  /**
   * Resolve configured Google headers at init (not at request time): the native
   * Google auth header (`GOOGLE_AUTH_HEADER`) is built from the API key in
   * `getGoogleConfig` and lives in the same `customHeaders` map. Resolving the
   * admin templates here — before that key-derived header is added — keeps the
   * key out of placeholder/env expansion (a user-provided `${ENV}` key can't leak
   * server env) while still resolving admin headers (env, user, conversationId).
   * `req.body` lacks the assistant message id at init, so `{{LIBRECHAT_BODY_MESSAGEID}}`
   * is the one body placeholder unavailable here.
   */
  const mergedHeaders = mergeHeaders(allConfig?.headers, googleConfig?.headers);
  const headers = mergedHeaders
    ? resolveHeaders({ headers: mergedHeaders, user: req.user, body: req.body })
    : undefined;

  clientOptions = {
    reverseProxyUrl: GOOGLE_REVERSE_PROXY ?? undefined,
    authHeader: isEnabled(GOOGLE_AUTH_HEADER) ?? undefined,
    proxy: PROXY ?? undefined,
    ...(headers && { headers }),
    modelOptions: model_parameters ?? {},
    forceVertex: isVertexEndpoint,
    projectId: isVertexEndpoint
      ? (process.env.VERTEX_PROJECT_ID ??
        process.env.GOOGLE_CLOUD_PROJECT ??
        process.env.GCLOUD_PROJECT ??
        process.env.GOOGLE_PROJECT_ID)
      : undefined,
    ...clientOptions,
  };

  return getGoogleConfig(credentials, clientOptions);
}
