import { ErrorTypes, EModelEndpoint, mapModelToAzureConfig } from 'librechat-data-provider';
import type {
  BaseInitializeParams,
  InitializeResultBase,
  OpenAIConfigOptions,
  UserKeyValues,
} from '~/types';
import {
  mergeHeaders,
  resolveHeaders,
  isUserProvided,
  isNoUserKeyError,
  checkUserKeyExpiry,
  getAzureCredentials,
} from '~/utils';
import { getTarsProviderApiKey, resolveTarsProviderKey } from '~/tars';
import { validateEndpointURL } from '~/auth';
import { getOpenAIConfig } from './config';

/**
 * Initializes OpenAI options for agent usage. This function always returns configuration
 * options and never creates a client instance (equivalent to optionsOnly=true behavior).
 *
 * @param params - Configuration parameters
 * @returns Promise resolving to OpenAI configuration options
 * @throws Error if API key is missing or user key has expired
 */
export async function initializeOpenAI({
  req,
  endpoint,
  model_parameters,
  db,
}: BaseInitializeParams): Promise<InitializeResultBase> {
  const appConfig = req.config;
  const openAIConfig = appConfig?.endpoints?.[EModelEndpoint.openAI];
  const allConfig = appConfig?.endpoints?.all;
  const { PROXY, AZURE_API_KEY, OPENAI_REVERSE_PROXY, AZURE_OPENAI_BASEURL } = process.env;
  /** sys_config-managed key overrides env unless the admin opted into per-user keys. */
  const OPENAI_API_KEY = await resolveTarsProviderKey(
    process.env.OPENAI_API_KEY,
    EModelEndpoint.openAI,
  );

  const { key: expiresAt } = req.body;
  const modelName = model_parameters?.model as string | undefined;

  const credentials = {
    [EModelEndpoint.openAI]: OPENAI_API_KEY,
    [EModelEndpoint.azureOpenAI]: AZURE_API_KEY,
  };

  const baseURLOptions = {
    [EModelEndpoint.openAI]: OPENAI_REVERSE_PROXY,
    [EModelEndpoint.azureOpenAI]: AZURE_OPENAI_BASEURL,
  };

  const userProvidesKey = isUserProvided(credentials[endpoint as keyof typeof credentials]);
  const userProvidesURL = isUserProvided(baseURLOptions[endpoint as keyof typeof baseURLOptions]);

  const isOpenAIProvider = endpoint === EModelEndpoint.openAI;
  if (expiresAt && (userProvidesKey || userProvidesURL)) {
    checkUserKeyExpiry(expiresAt, endpoint);
  }

  let userValues: UserKeyValues | null = null;
  /** Sentinel mode fetches the personal key even without `expiresAt` (the
   *  gateway passthrough sends no `key` body field). */
  const shouldFetchUserValues =
    (!!expiresAt && (userProvidesKey || userProvidesURL)) ||
    (isOpenAIProvider && userProvidesKey && !!req.user?.id);
  if (shouldFetchUserValues) {
    try {
      userValues = await db.getUserKeyValues({ userId: req.user?.id ?? '', name: endpoint });
    } catch (error) {
      /** A missing personal key is tolerated only where sys_config can supply
       *  the openAI key below; Azure and user-provided-URL flows keep throwing. */
      if (!isOpenAIProvider || userProvidesURL || !isNoUserKeyError(error)) {
        throw error;
      }
      userValues = null;
    }
  }

  let apiKey = userProvidesKey
    ? userValues?.apiKey
    : credentials[endpoint as keyof typeof credentials];
  if (isOpenAIProvider && userProvidesKey && !apiKey) {
    apiKey = await getTarsProviderApiKey(EModelEndpoint.openAI);
  }
  const baseURL = userProvidesURL
    ? userValues?.baseURL
    : baseURLOptions[endpoint as keyof typeof baseURLOptions];

  const clientOptions: OpenAIConfigOptions = {
    proxy: PROXY ?? undefined,
    reverseProxyUrl: baseURL || undefined,
    baseURLIsUserProvided: userProvidesURL,
    allowedAddresses: appConfig?.endpoints?.allowedAddresses,
    streaming: true,
  };

  /**
   * Custom headers are forwarded only when the destination URL is admin-trusted.
   * When the user supplies the base URL, withhold them — they may carry
   * `${SECRET}` gateway values or user/OpenID token placeholders resolved later
   * by `resolveConfigHeaders`, which must not reach a user-controlled endpoint.
   */
  const trustedURL = !userProvidesURL;
  const globalHeaders = trustedURL ? allConfig?.headers : undefined;
  const openAIHeaders = trustedURL
    ? mergeHeaders(allConfig?.headers, openAIConfig?.headers)
    : undefined;

  const isAzureOpenAI = endpoint === EModelEndpoint.azureOpenAI;
  const azureConfig = isAzureOpenAI && appConfig?.endpoints?.[EModelEndpoint.azureOpenAI];
  let isServerless = false;

  if (isAzureOpenAI && azureConfig) {
    const { modelGroupMap, groupMap } = azureConfig;
    const {
      azureOptions,
      baseURL: configBaseURL,
      headers = {},
      serverless,
    } = mapModelToAzureConfig({
      modelName: modelName || '',
      modelGroupMap,
      groupMap,
    });
    isServerless = serverless === true;

    clientOptions.reverseProxyUrl = configBaseURL ?? clientOptions.reverseProxyUrl;
    if (configBaseURL) {
      clientOptions.baseURLIsUserProvided = false;
    }
    clientOptions.headers = resolveHeaders({
      headers: { ...headers, ...(clientOptions.headers ?? {}) },
      user: req.user,
    });
    /** `endpoints.all` headers apply globally, but stay unresolved here — they are
     *  resolved once at request time by `resolveConfigHeaders`. Resolving them now
     *  (in addition) would re-expand already-substituted user values, violating the
     *  env-before-user invariant. Azure-managed headers stay authoritative. */
    if (globalHeaders) {
      clientOptions.headers = mergeHeaders(globalHeaders, clientOptions.headers);
    }

    const groupName = modelGroupMap[modelName || '']?.group;
    if (groupName && groupMap[groupName]) {
      clientOptions.addParams = groupMap[groupName]?.addParams;
      clientOptions.dropParams = groupMap[groupName]?.dropParams;
    }

    apiKey = azureOptions.azureOpenAIApiKey;
    clientOptions.azure = !isServerless ? azureOptions : undefined;

    if (isServerless) {
      clientOptions.defaultQuery = azureOptions.azureOpenAIApiVersion
        ? { 'api-version': azureOptions.azureOpenAIApiVersion }
        : undefined;

      if (!clientOptions.headers) {
        clientOptions.headers = {};
      }
      clientOptions.headers['api-key'] = apiKey;
    }
  } else if (isAzureOpenAI) {
    clientOptions.azure =
      userProvidesKey && userValues?.apiKey ? JSON.parse(userValues.apiKey) : getAzureCredentials();
    apiKey = clientOptions.azure ? clientOptions.azure.azureOpenAIApiKey : undefined;
    /** Env-var Azure path has no per-model headers; still honor global `all` headers. */
    if (globalHeaders) {
      clientOptions.headers = { ...globalHeaders };
    }
  } else {
    /**
     * Attach admin-configured custom headers for the built-in OpenAI endpoint
     * (endpoint over global `all`). Kept unresolved here so request-body
     * placeholders resolve at request time via `resolveConfigHeaders`.
     */
    if (openAIHeaders) {
      clientOptions.headers = openAIHeaders;
    }
  }

  if (clientOptions.baseURLIsUserProvided && clientOptions.reverseProxyUrl) {
    await validateEndpointURL(
      clientOptions.reverseProxyUrl,
      endpoint,
      appConfig?.endpoints?.allowedAddresses,
    );
  }

  if (userProvidesKey && !apiKey) {
    throw new Error(
      JSON.stringify({
        type: ErrorTypes.NO_USER_KEY,
      }),
    );
  }

  if (!apiKey) {
    throw new Error(`${endpoint} API Key not provided.`);
  }

  const modelOptions = {
    ...(model_parameters ?? {}),
    model: modelName,
    user: req.user?.id,
  };

  const finalClientOptions: OpenAIConfigOptions = {
    ...clientOptions,
    modelOptions,
  };

  const options = getOpenAIConfig(apiKey, finalClientOptions, endpoint);

  /** Set useLegacyContent for Azure serverless deployments */
  if (isServerless) {
    (options as InitializeResultBase).useLegacyContent = true;
  }

  const azureRate = modelName?.includes('gpt-4') ? 30 : 17;

  let streamRate: number | undefined;

  if (isAzureOpenAI && azureConfig) {
    streamRate = azureConfig.streamRate ?? azureRate;
  } else if (!isAzureOpenAI && openAIConfig) {
    streamRate = openAIConfig.streamRate;
  }

  if (allConfig?.streamRate) {
    streamRate = allConfig.streamRate;
  }

  if (streamRate) {
    options.llmConfig._lc_stream_delay = streamRate;
  }

  return options;
}
