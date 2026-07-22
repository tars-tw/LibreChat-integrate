import { ErrorTypes, EModelEndpoint, AuthKeys } from 'librechat-data-provider';
import type { BaseInitializeParams, InitializeResultBase, AnthropicConfigOptions } from '~/types';
import { isEnabled, isNoUserKeyError, mergeHeaders } from '~/utils';
import { loadAnthropicVertexCredentials, getVertexCredentialOptions } from './vertex';
import { getTarsProviderApiKey, resolveTarsProviderKey, isExpiredKeyCoveredByTars } from '~/tars';
import { getLLMConfig } from './llm';

/**
 * Initializes Anthropic endpoint configuration.
 * Supports both direct API key authentication and Google Cloud Vertex AI.
 *
 * @param params - Configuration parameters
 * @returns Promise resolving to Anthropic configuration options
 * @throws Error if API key is not provided (when not using Vertex AI)
 */
export async function initializeAnthropic({
  req,
  endpoint,
  model_parameters,
  db,
}: BaseInitializeParams): Promise<InitializeResultBase> {
  void endpoint;
  const appConfig = req.config;
  const { ANTHROPIC_API_KEY, ANTHROPIC_REVERSE_PROXY, PROXY } = process.env;
  const { key: expiresAt } = req.body;

  let credentials: Record<string, unknown> = {};
  let vertexOptions: { region?: string; projectId?: string } | undefined;

  /** @type {undefined | import('librechat-data-provider').TVertexAIConfig} */
  const vertexConfig = appConfig?.endpoints?.[EModelEndpoint.anthropic]?.vertexConfig;

  // Check for Vertex AI configuration: YAML config takes priority over env var
  // When vertexConfig exists and enabled is not explicitly false, Vertex AI is enabled
  const useVertexAI =
    (vertexConfig && vertexConfig.enabled !== false) || isEnabled(process.env.ANTHROPIC_USE_VERTEX);

  if (useVertexAI) {
    // Load credentials with optional YAML config overrides
    const credentialOptions = vertexConfig ? getVertexCredentialOptions(vertexConfig) : undefined;
    credentials = await loadAnthropicVertexCredentials(credentialOptions);

    // Store vertex options for client creation
    if (vertexConfig) {
      vertexOptions = {
        region: vertexConfig.region,
        projectId: vertexConfig.projectId,
      };
    }
  } else {
    /** sys_config-managed key overrides env; the Vertex path never consults pwc_tars. */
    const anthropicKey = await resolveTarsProviderKey(ANTHROPIC_API_KEY, EModelEndpoint.anthropic);
    const isUserProvided = anthropicKey === 'user_provided';

    let anthropicApiKey = isUserProvided ? undefined : anthropicKey;
    if (isUserProvided) {
      /** An expired personal key is ignored when an active sys_config key
       *  covers the provider — the fallback below then supplies it. */
      const expiredKeyCovered = expiresAt
        ? await isExpiredKeyCoveredByTars(expiresAt, EModelEndpoint.anthropic)
        : false;
      if (!expiredKeyCovered && req.user?.id) {
        try {
          anthropicApiKey = await db.getUserKey({
            userId: req.user.id,
            name: EModelEndpoint.anthropic,
          });
        } catch (error) {
          /** No stored personal key is a soft miss — sys_config may cover it below. */
          if (!isNoUserKeyError(error)) {
            throw error;
          }
          anthropicApiKey = undefined;
        }
      }
      if (!anthropicApiKey) {
        anthropicApiKey = await getTarsProviderApiKey(EModelEndpoint.anthropic);
      }
      if (!anthropicApiKey) {
        throw new Error(JSON.stringify({ type: ErrorTypes.NO_USER_KEY }));
      }
    }

    if (!anthropicApiKey) {
      throw new Error('Anthropic API key not provided. Please provide it again.');
    }

    credentials[AuthKeys.ANTHROPIC_API_KEY] = anthropicApiKey;
  }

  const anthropicConfig = appConfig?.endpoints?.[EModelEndpoint.anthropic];
  const allConfig = appConfig?.endpoints?.all;

  const headers = mergeHeaders(allConfig?.headers, anthropicConfig?.headers);

  const clientOptions: AnthropicConfigOptions = {
    proxy: PROXY ?? undefined,
    reverseProxyUrl: ANTHROPIC_REVERSE_PROXY ?? undefined,
    modelOptions: {
      ...(model_parameters ?? {}),
      user: req.user?.id,
    },
    ...(headers && { headers }),
    // Pass Vertex AI options if configured
    ...(vertexOptions && { vertexOptions }),
    // Pass full Vertex AI config including model mappings
    ...(vertexConfig && { vertexConfig }),
  };

  const result = getLLMConfig(credentials, clientOptions);

  if (anthropicConfig?.streamRate) {
    (result.llmConfig as Record<string, unknown>)._lc_stream_delay = anthropicConfig.streamRate;
  }

  if (allConfig?.streamRate) {
    (result.llmConfig as Record<string, unknown>)._lc_stream_delay = allConfig.streamRate;
  }

  return result;
}
