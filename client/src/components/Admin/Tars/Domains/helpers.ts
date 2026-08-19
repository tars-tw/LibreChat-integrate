import type { TTarsDomain, TTarsRole } from 'librechat-data-provider';
import { csvToIds } from '../Users/helpers';

/**
 * A capability toggle pair as pwc_tars stores it inside `domain_functions`.
 * `enabled` decides whether the brain offers the feature at all; `default_value`
 * decides whether it starts switched on for the user. Some keys only carry
 * `enabled`, which is why `default_value` is optional.
 */
export type DomainFunction = { enabled: boolean; default_value?: boolean };
export type DomainFunctionMap = Record<string, DomainFunction>;

/**
 * Capability keys pwc_tars keeps under `domain_functions`. `DUAL` keys carry an
 * `enabled` plus a `default_value` flag; `SINGLE` keys only carry `enabled`.
 * They are not edited in LibreChat — the editor leaves the whole block alone —
 * but an embedded-site brain has to switch every one of them off.
 */
const DUAL_FUNCTION_KEYS = [
  'web_search',
  'rag_search',
  'file_generate',
  'suggested_questions',
] as const;

const SINGLE_FUNCTION_KEYS = [
  'file_upload',
  'rag_source_download',
  'my_prompts',
  'longterm_memory',
  'model_parameters',
  'mcp_manage',
] as const;

export const parseDomainFunctions = (raw: string | null | undefined): DomainFunctionMap => {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const map: DomainFunctionMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (key === 'model_settings' || value == null || typeof value !== 'object') {
        continue;
      }
      const entry = value as DomainFunction;
      map[key] = {
        enabled: entry.enabled !== false,
        default_value: entry.default_value,
      };
    }
    return map;
  } catch {
    return {};
  }
};

/**
 * The `domain_functions` payload for an embedded-site brain. pwc_tars replaces
 * the block wholesale, so every known capability is written back switched off,
 * and any key a newer pwc_tars build added is disabled rather than dropped.
 *
 * A chat brain never calls this: the editor omits `domain_functions` entirely so
 * pwc_tars keeps the stored block on update and applies its own defaults on create.
 */
export const disabledDomainFunctions = (original: string | null | undefined): string => {
  let carried: Record<string, unknown> = {};
  if (original) {
    try {
      carried = JSON.parse(original) as Record<string, unknown>;
    } catch {
      carried = {};
    }
  }

  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(carried)) {
    if (key === 'model_settings' || value == null || typeof value !== 'object') {
      continue;
    }
    const entry = value as DomainFunction;
    next[key] =
      entry.default_value === undefined
        ? { enabled: false }
        : { enabled: false, default_value: false };
  }
  for (const key of DUAL_FUNCTION_KEYS) {
    next[key] = { enabled: false, default_value: false };
  }
  for (const key of SINGLE_FUNCTION_KEYS) {
    next[key] = { enabled: false };
  }
  next.model_settings = { default_model: '', available_models: [] };
  return JSON.stringify(next);
};

export const domainKnowledgeBaseIds = (domain: TTarsDomain): string[] =>
  csvToIds(domain.knowledge_base_ids);

/**
 * The roles bound to a brain. pwc_tars keeps this on both sides — `sys_domain.role_ids`
 * and each role's `domain_ids` — and rewrites the role side on every update, so
 * the role list is the authoritative view and is what the editor seeds from.
 */
export const domainRoleIds = (domain: TTarsDomain, roles: TTarsRole[]): string[] =>
  roles
    .filter((role) => csvToIds(role.domain_ids ?? '').includes(String(domain.id)))
    .map((role) => String(role.id));

export const isIframeDomain = (domain: TTarsDomain): boolean =>
  !!domain.iframe_url && domain.iframe_url.trim() !== '';

export const isValidHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};
