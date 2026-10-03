import { isTarsModelEndpoint, isTarsModelType, TARS_MODEL_TYPES } from 'librechat-data-provider';
import { invalidateTarsLocalModelsCache, invalidateTarsModelProfilesCache } from './models';
import { tarsFetch, TarsRequestError } from './client';

/** A pwc_tars `model_profile` row as the model admin page sees it. Mirrors `ModelProfile.to_json()`. */
export interface TarsModelProfile {
  id: string;
  name: string;
  version: string | null;
  type: string | null;
  /** Plain text, or a JSON object keyed by locale (`{"zh-TW": …, "en-US": …}`). */
  description: string | null;
  /** 1 = enabled, 0 = disabled. */
  status: number;
  /** JSON object text; null or '' means "no settings". */
  config: string | null;
  endpoint: string | null;
  api_version: string | null;
  created_by?: string | null;
  created_at?: string | null;
  updated_by?: string | null;
  updated_at?: string | null;
}

/**
 * What pwc_tars retargeted when a profile was disabled, deleted or renamed:
 * the model the references now point at and how many rows of each kind moved.
 */
export interface TarsModelProfileSync {
  target: { id: string; name: string } | null;
  knowledge_base: number;
  sys_model: number;
  sys_rag_model: number;
  sys_domain: number;
}

/** Create/update payload. On update an omitted field is left as is and '' clears it. */
export interface TarsModelProfileInput {
  name?: string;
  version?: string;
  type?: string;
  description?: string;
  config?: string;
  endpoint?: string;
  apiVersion?: string;
  /** Update only: pwc_tars creates every profile enabled. */
  enabled?: boolean;
}

export interface TarsModelProfileWriteResult {
  profile: TarsModelProfile;
  sync: TarsModelProfileSync | null;
}

/**
 * A profile write changes the model whitelist the chat model selector locks on
 * and which endpoints pwc_tars health-checks, so both caches are dropped rather
 * than left to serve the old list until their TTL runs out.
 */
const invalidateModelCaches = () => {
  invalidateTarsModelProfilesCache();
  invalidateTarsLocalModelsCache();
};

const blankToNull = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

/** pwc_tars `update_model_profile` body fields; a missing/null field is kept as is. */
interface TarsModelProfileUpdateBody {
  name?: string;
  version?: string;
  type?: string;
  description?: string;
  config?: string;
  endpoint?: string;
  api_version?: string;
  status?: number;
}

const toUpdateBody = (input: TarsModelProfileInput): TarsModelProfileUpdateBody => ({
  name: input.name?.trim(),
  version: input.version?.trim(),
  type: input.type?.trim(),
  description: input.description,
  config: input.config,
  endpoint: input.endpoint?.trim(),
  api_version: input.apiVersion?.trim(),
  status: input.enabled === undefined ? undefined : Number(input.enabled),
});

const CREATE_PATH = '/api/model/create_model_profile';
const UPDATE_PATH = '/api/model/update_model_profile';

/**
 * pwc_tars stores any type and endpoint it is given, and a model with a bad
 * endpoint only fails once someone chats with it. The type and endpoint are
 * checked here against the same rules as the admin form, and a bad one is
 * answered the way pwc_tars answers its own 400s, so the route relays both alike.
 * On update only the fields being changed are checked, which lets a row that
 * still carries a legacy type be edited without touching it.
 */
const assertValidInput = (path: string, input: TarsModelProfileInput, creating: boolean) => {
  if ((creating || input.type !== undefined) && !isTarsModelType(input.type?.trim())) {
    throw new TarsRequestError(400, path, `type must be one of ${TARS_MODEL_TYPES.join(', ')}`);
  }
  if ((creating || input.endpoint !== undefined) && !isTarsModelEndpoint(input.endpoint)) {
    throw new TarsRequestError(400, path, 'endpoint must be an http:// or https:// URL');
  }
};

/** Every profile that is not deleted, disabled ones included (`GET /api/model/admin/get_model_profiles`). */
export async function fetchTarsModelProfiles(
  tarsId: string,
  baseUrl?: string,
): Promise<TarsModelProfile[]> {
  const data = await tarsFetch<{ model_profiles?: TarsModelProfile[] }>(
    '/api/model/admin/get_model_profiles',
    { query: { user_id: tarsId }, baseUrl },
  );
  return data?.model_profiles ?? [];
}

export async function createTarsModelProfile(
  tarsId: string,
  input: TarsModelProfileInput,
  baseUrl?: string,
): Promise<TarsModelProfile> {
  assertValidInput(CREATE_PATH, input, true);
  const profile = await tarsFetch<TarsModelProfile>(CREATE_PATH, {
    method: 'POST',
    body: {
      name: input.name?.trim() ?? '',
      type: input.type?.trim() ?? '',
      endpoint: input.endpoint?.trim() ?? '',
      version: blankToNull(input.version),
      description: blankToNull(input.description),
      config: blankToNull(input.config),
      api_version: blankToNull(input.apiVersion),
      created_by: tarsId,
      user_id: tarsId,
    },
    baseUrl,
  });
  invalidateModelCaches();
  return profile;
}

/**
 * Disabling or renaming makes pwc_tars retarget the knowledge bases, model
 * settings and brains that reference the profile; it answers 409 when no
 * system default model is left to take them over.
 */
export async function updateTarsModelProfile(
  tarsId: string,
  id: string,
  input: TarsModelProfileInput,
  baseUrl?: string,
): Promise<TarsModelProfileWriteResult> {
  assertValidInput(UPDATE_PATH, input, false);
  const data = await tarsFetch<TarsModelProfile & { sync?: TarsModelProfileSync }>(UPDATE_PATH, {
    method: 'PUT',
    body: { ...toUpdateBody(input), id, updated_by: tarsId, user_id: tarsId },
    baseUrl,
  });
  invalidateModelCaches();
  const { sync, ...profile } = data;
  return { profile, sync: sync ?? null };
}

/**
 * Soft delete: pwc_tars keeps the row so historical `model_id` references still
 * resolve, and retargets live references exactly as a disable does (409 when
 * nothing can take them over).
 */
export async function deleteTarsModelProfile(
  tarsId: string,
  id: string,
  baseUrl?: string,
): Promise<{ sync: TarsModelProfileSync | null }> {
  const data = await tarsFetch<{ sync?: TarsModelProfileSync }>('/api/model/delete_model_profile', {
    method: 'DELETE',
    body: { id, user_id: tarsId },
    baseUrl,
  });
  invalidateModelCaches();
  return { sync: data?.sync ?? null };
}
