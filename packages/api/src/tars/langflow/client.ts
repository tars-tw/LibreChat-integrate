import { logger } from '@librechat/data-schemas';
import { getTarsModelProfileNames } from '~/tars/models';
import { getTarsSysConfigValue } from '~/tars/sysconfig';
import { tarsFetch } from '~/tars/client';

/** pwc_tars sys_config key holding the shared secret for `/api/langflow-service/*`. */
const SERVICE_KEY_CONFIG = 'KEY_LANGFLOW_API_KEY';
const SERVICE_KEY_HEADER = 'X-TARS-Service-Key';
/**
 * Headers that make pwc_tars drive the capability's LLM through LibreChat's
 * gateway. Always sent: pwc_tars hosts the tools but no longer carries language
 * models of its own, so every nested loop runs on LibreChat's models and quota.
 * `X-Librechat-User-Id` is what makes the gateway bill the acting user rather
 * than the anonymous service account.
 */
const GATEWAY_HEADER = 'X-Use-Librechat-Gateway';
const GATEWAY_USER_HEADER = 'X-Librechat-User-Id';

export interface LangflowGeneratedUrl {
  type?: string;
  url?: string;
}

/** The `data` payload shared by every `/api/langflow-service/*` capability. */
export interface LangflowCapabilityData {
  answer?: string;
  mode?: string;
  model_name?: string;
  tokens?: { total?: number; prompt?: number; completion?: number };
  generated_urls?: LangflowGeneratedUrl[];
  chart_url?: string;
  file_url?: string;
  data_files?: string[];
  sql?: string;
}

interface LangflowEnvelope {
  data?: LangflowCapabilityData;
}

export interface LangflowRequestOptions {
  timeoutMs: number;
  /** The account the gateway resolves models and quota for. */
  librechatUserId?: string;
}

/**
 * The `/api/langflow-service` service key. pwc_tars validates the whole
 * blueprint against the single `KEY_LANGFLOW_API_KEY` sys_config row, so that
 * row is the only source — there is nothing a per-caller override could
 * usefully differ on.
 */
export async function resolveLangflowServiceKey(): Promise<string | undefined> {
  return getTarsSysConfigValue(SERVICE_KEY_CONFIG);
}

/**
 * The pwc_tars model a nested capability loop runs on: the model this user's
 * current chat turn resolved to, or undefined, which lets pwc_tars pick its
 * default sys_model. Both ends of that come from pwc_tars, so there is no
 * LibreChat-side pin.
 *
 * The chat model is matched against pwc_tars's `model_profile` names — the same
 * list the model selector is filtered by, so the normal picker can only produce
 * a match — and the canonical spelling is what gets sent. `logLabel` keeps each
 * caller's fallback line greppable under its own tag. Saved agents and
 * assistants bypass that selector filter, and the filter fails open while
 * pwc_tars is unreachable, so an unmatched model falls back to the default
 * rather than letting pwc_tars reject the whole call.
 */
export async function resolveLangflowModelName(
  chatModel: string | undefined,
  logLabel = 'tars-langflow',
): Promise<string | undefined> {
  if (!chatModel) {
    return undefined;
  }
  const profiles = await getTarsModelProfileNames();
  const match = profiles?.find((name) => name.toLowerCase() === chatModel.toLowerCase());
  if (!match) {
    logger.debug(
      `[${logLabel}] Chat model "${chatModel}" is not a pwc_tars model_profile; falling back to the pwc_tars default`,
    );
  }
  return match;
}

/**
 * Runs one `/api/langflow-service/*` capability call and unwraps its
 * `{success, status, data}` envelope. pwc_tars owns the nested agent loop;
 * callers only shape the body and relay `data` back into the chat turn. The
 * loop's own LLM is requested through LibreChat's gateway — pwc_tars still has
 * the final say via its `FLAG_USE_LIBRECHAT_LLM` sys_config switch.
 */
export async function runLangflowCapability(
  path: string,
  body: Record<string, unknown>,
  options: LangflowRequestOptions,
): Promise<LangflowCapabilityData> {
  const key = await resolveLangflowServiceKey();
  if (!key) {
    throw new Error(
      `The pwc_tars service key is not configured (sys_config ${SERVICE_KEY_CONFIG}).`,
    );
  }

  const headers: Record<string, string> = {
    [SERVICE_KEY_HEADER]: key,
    [GATEWAY_HEADER]: 'true',
  };
  if (options.librechatUserId) {
    headers[GATEWAY_USER_HEADER] = options.librechatUserId;
  }

  const envelope = await tarsFetch<LangflowEnvelope>(path, {
    method: 'POST',
    timeoutMs: options.timeoutMs,
    headers,
    body,
  });
  return envelope?.data ?? {};
}

/** Positive-number env parse with a fallback, for per-capability timeouts. */
export function langflowTimeoutMs(env: string, fallback: number): number {
  const raw = Number(process.env[env]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}
