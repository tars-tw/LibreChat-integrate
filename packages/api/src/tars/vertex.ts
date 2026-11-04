import { logger } from '@librechat/data-schemas';
import type { GoogleConfigOptions } from '~/types';
import type { GoogleServiceKey } from '~/utils';
import { getTarsModelProfileNames, getTarsModelProfileEndpoint } from './models';
import { getTarsSysConfigValue } from './sysconfig';
import { getSecretPreview } from '~/admin/secrets';
import { loadServiceKey } from '~/utils';

/**
 * pwc_tars `SysConst.VERTEX_MODEL_MARKER`: a Gemini model_profile named with it
 * (`gemini-3.5-flash(enterprise)`, type `GOOGLE_VERTEX`) is served by Vertex AI
 * rather than the Gemini API, on its own credential.
 */
const MARKER_PATTERN = /\(enterprise\)/i;

/**
 * LangChain model `metadata` key naming the pwc_tars profile a Vertex call runs as.
 * The client must send the bare Vertex id, and LangChain reports that same id as
 * the call's `ls_model_name`, so usage is re-tagged from here.
 */
const USAGE_MODEL_KEY = 'tars_model';

/** The sys_config row pwc_tars authenticates its Vertex AI calls with. */
const TARS_VERTEX_KEY = 'KEY_VERTEX_AI_API';

/**
 * The location in a Vertex `model_profile.endpoint`: `https://…/v1/projects/<project>/locations/<location>/…`.
 * The client builds its host from it and sends the service account's token there, so only a
 * location token passes: `attacker.example#` would otherwise make `attacker.example` the host.
 */
const ENDPOINT_LOCATION_PATTERN = /\/locations\/([a-z0-9-]+)(?:\/|$)/;

/** The location an endpoint names only in its host: `https://<location>-aiplatform.googleapis.com/v1`. */
const ENDPOINT_HOST_LOCATION_PATTERN =
  /^https?:\/\/([a-z0-9-]+)-aiplatform\.googleapis\.com(?:[:/]|$)/i;

/** What pwc_tars seeds a Vertex profile with: every Gemini on Vertex is served from there. */
const DEFAULT_LOCATION = 'global';

/** What Google auth signs a service account token with; an OAuth client or other JSON lacks them. */
const SERVICE_ACCOUNT_FIELDS = ['project_id', 'client_email', 'private_key'] as const;

type TarsUsageMetadata = { [USAGE_MODEL_KEY]?: string } | null;

/** Port of pwc_tars `is_vertex_ai_model`: a Gemini model name carrying the enterprise marker. */
export function isTarsVertexModel(model?: string | null): boolean {
  const name = model ?? '';
  return MARKER_PATTERN.test(name) && /gemini/i.test(name);
}

/** The Vertex AI model id a marked name stands for: `gemini-3.5-flash(enterprise)` → `gemini-3.5-flash`. */
export function toTarsVertexModelId(model: string): string {
  return model.replace(MARKER_PATTERN, '').trim();
}

/** Model `metadata` that keeps a Vertex call's usage under its pwc_tars profile name. */
export function tarsVertexModelMetadata(modelName: string): Record<string, string> {
  return { [USAGE_MODEL_KEY]: modelName };
}

/**
 * A model call's usage, or client options carrying their own metadata, renamed to the pwc_tars
 * profile that metadata names (see {@link tarsVertexModelMetadata}) when the call ran that
 * profile's Vertex model. A call that inherits the agent's client options on another model
 * (summarization, a subagent) carries the same metadata, and keeps its own name.
 */
export function withTarsVertexUsageModel<
  T extends { model?: string; metadata?: TarsUsageMetadata },
>(usage: T, metadata: TarsUsageMetadata | undefined = usage.metadata): T {
  const profileName = metadata?.[USAGE_MODEL_KEY];
  if (!profileName || (usage.model && usage.model !== toTarsVertexModelId(profileName))) {
    return usage;
  }
  return { ...usage, model: profileName };
}

export interface TarsVertexDeps {
  /** An active sys_config value (see `getTarsSysConfigValue`). */
  getSysConfigValue: (key: string) => Promise<string | undefined>;
  /** The approved model_profile names, null when unrestricted (see `getTarsModelProfileNames`). */
  getModelProfileNames: () => Promise<string[] | null>;
  /** One model_profile's `endpoint` (see `getTarsModelProfileEndpoint`). */
  getModelProfileEndpoint: (name: string) => Promise<string | null | undefined>;
  parseServiceKey: (raw: string) => Promise<GoogleServiceKey | null>;
}

export interface TarsVertex {
  /**
   * The service account in sys_config `KEY_VERTEX_AI_API`, so a key an admin rotates
   * in pwc_tars needs no LibreChat change. pwc_tars also accepts a static API key there
   * (Vertex express mode); LibreChat's Vertex client authenticates with a service
   * account only, so that form — like an unset row or JSON that is not a service
   * account — yields undefined, and the service key file is used instead.
   */
  getServiceKey: () => Promise<GoogleServiceKey | undefined>;
  /**
   * `models` followed by every pwc_tars model_profile served by Vertex AI, which the
   * `google` endpoint routes there — so a Vertex model is added on the pwc_tars side
   * alone. Without a usable service account they are left out, so the picker never
   * offers a model whose every request would fail; the service key file then serves
   * only the gateway and models pinned in `GOOGLE_MODELS`. Logs which of them are available
   * and on which key, masked, each time that changes.
   */
  withModels: (models: string[]) => Promise<string[]>;
  /**
   * Refuses a model that is neither listed by pwc_tars nor pinned in `GOOGLE_MODELS`, as does a list
   * that cannot be read. The agent APIs and the gateway take any model string, and this one runs on
   * the organization's service account with its name in the Vertex URL.
   */
  assertModel: (modelName: string, pinnedModels: string[]) => Promise<void>;
  /**
   * What a pwc_tars Vertex model overrides in the `google` endpoint's client options. Refuses a model
   * whose location cannot be read or is malformed, which could be a region pwc_tars records for compliance;
   * `configuredLocation` (`GOOGLE_LOC`, which `getGoogleConfig` prefers anyway) needs no read.
   */
  getClientOptions: (
    modelName: string,
    modelParameters?: GoogleConfigOptions['modelOptions'],
    configuredLocation?: string,
  ) => Promise<GoogleConfigOptions>;
}

function isServiceAccount(key: Record<string, unknown> | null): key is GoogleServiceKey {
  return key != null && SERVICE_ACCOUNT_FIELDS.every((field) => typeof key[field] === 'string');
}

/** Refuses a key that cannot authenticate these models, from sys_config or the key file alike. */
export function assertTarsVertexServiceAccount(
  modelName: string,
  key: Record<string, unknown>,
): void {
  if (!isServiceAccount(key)) {
    throw new Error(
      `Vertex AI model "${modelName}" needs a service account: set pwc_tars sys_config ${TARS_VERTEX_KEY} or GOOGLE_SERVICE_KEY_FILE`,
    );
  }
}

/** Which key a log line means, with only what cannot authenticate: never `private_key`. */
function describeKey(key: GoogleServiceKey | undefined): string {
  if (!key) {
    return 'GOOGLE_SERVICE_KEY_FILE, pinned in GOOGLE_MODELS';
  }
  /** Parsed JSON, where only the fields that authenticate were checked: a log line must not throw. */
  const { private_key_id: id } = key;
  const keyId = id && typeof id === 'string' ? `, key id ${getSecretPreview(id)}` : '';
  return `sys_config ${TARS_VERTEX_KEY} (project ${key.project_id}${keyId})`;
}

function readLocation(modelName: string, endpoint: string | null | undefined): string {
  if (endpoint === null) {
    throw new Error(
      `Vertex AI model "${modelName}" has no known location: pwc_tars did not return its model_profile (a failed read logs a [TarsModelProfiles] warning) and GOOGLE_LOC is not set`,
    );
  }
  const location = ENDPOINT_LOCATION_PATTERN.exec(endpoint ?? '')?.[1];
  if (!location && endpoint?.includes('/locations/')) {
    throw new Error(
      `Vertex AI model "${modelName}" has an invalid location in its pwc_tars model_profile.endpoint: correct it or set GOOGLE_LOC`,
    );
  }
  const hostLocation = ENDPOINT_HOST_LOCATION_PATTERN.exec(endpoint ?? '')?.[1];
  return location ?? hostLocation?.toLowerCase() ?? DEFAULT_LOCATION;
}

export function createTarsVertex(deps: TarsVertexDeps): TarsVertex {
  /** The last sys_config value and its parse, in flight or done, so a key is parsed — and an unusable one reported — once per value. */
  let parsed: { raw: string; key: Promise<GoogleServiceKey | undefined> } | undefined;
  /** The last report: the model list is read on every request, so only a change is logged. */
  let reported = '';

  async function parse(raw: string): Promise<GoogleServiceKey | undefined> {
    /** The parser would take an API key for a file path. */
    const key = raw.startsWith('{') ? await deps.parseServiceKey(raw).catch(() => null) : null;
    if (isServiceAccount(key)) {
      return key;
    }
    logger.warn(
      `[Gemini Enterprise] ${TARS_VERTEX_KEY} is not service account JSON (needs ${SERVICE_ACCOUNT_FIELDS.join(', ')}), so its Vertex models are hidden`,
    );
    return undefined;
  }

  async function getServiceKey(): Promise<GoogleServiceKey | undefined> {
    const raw = await deps.getSysConfigValue(TARS_VERTEX_KEY);
    if (!raw) {
      return undefined;
    }
    if (parsed?.raw !== raw) {
      parsed = { raw, key: parse(raw) };
    }
    return parsed.key;
  }

  /**
   * One line a model: the debug file and JSON console cut a long message, which would drop names.
   * Sorted, since pwc_tars does not order a type's rows and a new order is not a change.
   */
  function reportModels(key: GoogleServiceKey | undefined, offered: string[]): void {
    const available = offered.filter(isTarsVertexModel).sort();
    const lines = available.length
      ? [
          `[Gemini Enterprise] Gemini enterprise models on ${describeKey(key)}: ${available.length} available`,
          ...available.map((name) => `[Gemini Enterprise]   available: ${name}`),
        ]
      : [];
    const report = lines.join('\n');
    if (report !== reported) {
      reported = report;
      (lines.length
        ? lines
        : ['[Gemini Enterprise] No Gemini enterprise models available']
      ).forEach((line) => logger.info(line));
    }
  }

  async function withModels(models: string[]): Promise<string[]> {
    const [profiles, key] = await Promise.all([deps.getModelProfileNames(), getServiceKey()]);
    if (!profiles) {
      return models;
    }
    const offered = key ? [...new Set([...models, ...profiles.filter(isTarsVertexModel)])] : models;
    reportModels(key, offered);
    return offered;
  }

  async function assertModel(modelName: string, pinnedModels: string[]): Promise<void> {
    if (pinnedModels.includes(modelName)) {
      return;
    }
    const profiles = await deps.getModelProfileNames();
    if (!profiles?.includes(modelName)) {
      throw new Error(
        `Vertex AI model "${modelName}" is not listed by pwc_tars or pinned in GOOGLE_MODELS`,
      );
    }
  }

  async function getClientOptions(
    modelName: string,
    modelParameters?: GoogleConfigOptions['modelOptions'],
    configuredLocation?: string,
  ): Promise<GoogleConfigOptions> {
    const defaultLocation =
      configuredLocation || readLocation(modelName, await deps.getModelProfileEndpoint(modelName));
    return {
      /** The Gemini API's gateway settings; these models go to Google on their service account. */
      reverseProxyUrl: undefined,
      authHeader: undefined,
      /**
       * The service account's project, as pwc_tars's own Vertex embeddings use. The endpoint's can
       * still be the seed's `YOUR_PROJECT_ID`, since pwc_tars does not probe a cloud endpoint.
       */
      projectId: undefined,
      /** pwc_tars records a region chosen for compliance here, per model. */
      defaultLocation,
      modelOptions: { ...modelParameters, model: toTarsVertexModelId(modelName) },
    };
  }

  return { getServiceKey, withModels, assertModel, getClientOptions };
}

const tarsVertex = createTarsVertex({
  getSysConfigValue: getTarsSysConfigValue,
  getModelProfileNames: getTarsModelProfileNames,
  getModelProfileEndpoint: getTarsModelProfileEndpoint,
  parseServiceKey: loadServiceKey,
});

/** {@link TarsVertex.getServiceKey} over the live pwc_tars sys_config. */
export const getTarsVertexServiceKey: TarsVertex['getServiceKey'] = tarsVertex.getServiceKey;

/** {@link TarsVertex.withModels} over the live pwc_tars model list. */
export const withTarsVertexModels: TarsVertex['withModels'] = tarsVertex.withModels;

/** {@link TarsVertex.assertModel} over the live pwc_tars model list. */
export const assertTarsVertexModel: TarsVertex['assertModel'] = tarsVertex.assertModel;

/** {@link TarsVertex.getClientOptions} over the live pwc_tars model_profile rows. */
export const getTarsVertexClientOptions: TarsVertex['getClientOptions'] =
  tarsVertex.getClientOptions;
