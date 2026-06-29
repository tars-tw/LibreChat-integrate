import { EModelEndpoint } from 'librechat-data-provider';
import type { Agent, AgentModelParameters } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import type { LoadAgentDeps, LoadAgentParams } from './load';
import { getCustomEndpointConfig } from '~/app/config';
import { loadEphemeralAgent } from './load';

/**
 * Parsed `provider/model` pair for the model-passthrough gateway.
 * `endpoint` is a LibreChat provider name (e.g. `openAI`); `model` is the
 * real model id forwarded to that provider (e.g. `gpt-5.4-mini`).
 */
export interface ParsedPassthroughModel {
  endpoint: string;
  model: string;
}

export type PassthroughResolution =
  | { ok: true; value: ParsedPassthroughModel }
  | { ok: false; error: string };

const builtinEndpoints = new Set<string>(Object.values(EModelEndpoint));

/**
 * Sampling parameters accepted on the OpenAI request body, mapped to their
 * LibreChat `model_parameters` (camelCase) equivalents so the gateway honors
 * the caller's settings instead of silently dropping them.
 */
const samplingParamMap: Record<string, string> = {
  temperature: 'temperature',
  top_p: 'topP',
  max_tokens: 'maxTokens',
  frequency_penalty: 'frequencyPenalty',
  presence_penalty: 'presencePenalty',
  stop: 'stop',
};

function isKnownEndpoint(endpoint: string, appConfig?: AppConfig): boolean {
  if (builtinEndpoints.has(endpoint)) {
    return true;
  }
  try {
    return getCustomEndpointConfig({ endpoint, appConfig }) != null;
  } catch {
    return false;
  }
}

/**
 * Resolve a passthrough `model` field of the form `"<provider>/<model>"`.
 * The provider prefix is required and validated against built-in and custom
 * endpoints; LibreChat has no reverse model→provider map, so an unprefixed
 * model is rejected rather than guessed.
 */
export function resolvePassthroughModel(
  rawModel: string,
  appConfig?: AppConfig,
): PassthroughResolution {
  const slashIndex = rawModel.indexOf('/');
  if (slashIndex <= 0 || slashIndex === rawModel.length - 1) {
    return {
      ok: false,
      error: `model must be prefixed with a provider, e.g. 'openAI/gpt-5.4-mini' (got: '${rawModel}')`,
    };
  }
  const endpoint = rawModel.slice(0, slashIndex);
  const model = rawModel.slice(slashIndex + 1);
  if (!isKnownEndpoint(endpoint, appConfig)) {
    return { ok: false, error: `Unknown provider endpoint: '${endpoint}'` };
  }
  return { ok: true, value: { endpoint, model } };
}

function extractModelParameters(
  body: Record<string, unknown> | undefined,
  model: string,
): AgentModelParameters & { model: string } {
  const params: Record<string, unknown> = { model };
  if (body) {
    for (const openaiKey of Object.keys(samplingParamMap)) {
      const value = body[openaiKey];
      if (value !== undefined && value !== null) {
        params[samplingParamMap[openaiKey]] = value;
      }
    }
  }
  return params as AgentModelParameters & { model: string };
}

/**
 * Build a `getAgent`-shaped function for {@link createAgentChatCompletion} that
 * returns a synthetic ephemeral agent (no tools, no system prompt) bound to the
 * resolved provider/model instead of looking up a stored agent.
 *
 * The request body is intentionally NOT forwarded to `loadEphemeralAgent`:
 * sampling params are extracted explicitly, and `promptPrefix` / `ephemeralAgent`
 * are dropped so a caller cannot turn the bare passthrough into a tool-enabled
 * or instruction-bearing agent.
 */
export function buildPassthroughGetAgent(
  req: LoadAgentParams['req'],
  resolved: ParsedPassthroughModel,
  deps: LoadAgentDeps,
): (params: { id: string }) => Promise<Agent | null> {
  const model_parameters = extractModelParameters(
    req.body as Record<string, unknown> | undefined,
    resolved.model,
  );
  const sanitizedReq: LoadAgentParams['req'] = {
    user: req.user,
    config: req.config,
    body: {},
  };
  return () =>
    loadEphemeralAgent({ req: sanitizedReq, endpoint: resolved.endpoint, model_parameters }, deps);
}
