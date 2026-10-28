import type {
  TTarsMcpBoundValue,
  TTarsMcpOpenapiField,
  TTarsMcpParsedTool,
  TTarsMcpSyncResult,
} from 'librechat-data-provider';

/** `tool_config.bound_values`: fixed values per `"METHOD /path"` endpoint. */
export type BoundValues = Record<string, TTarsMcpBoundValue[]>;

/** A static header row as edited; pwc_tars stores them as `connection_config.headers`. */
export interface HeaderRow {
  name: string;
  value: string;
}

type FieldRef = Pick<TTarsMcpOpenapiField, 'in' | 'name'>;

/**
 * Fixed values are keyed by endpoint rather than tool name, so a naming change
 * (prefix, snake_case) does not detach them. Mirrors pwc_tars `bound_endpoint_key`.
 */
export const endpointOf = (tool: Pick<TTarsMcpParsedTool, 'method' | 'path'>): string =>
  `${(tool.method ?? '').toUpperCase()} ${tool.path ?? ''}`;

export const isSameField = (a: FieldRef, b: FieldRef): boolean =>
  a.in === b.in && a.name === b.name;

export const boundValueOf = (bound: BoundValues, endpoint: string, field: FieldRef): string =>
  (bound[endpoint] ?? []).find((binding) => isSameField(binding, field))?.value ?? '';

/**
 * Returns a new map with `field` of `endpoint` bound to `value`. A blank value
 * removes the binding (handing the field back to the AI), and an endpoint left
 * without bindings drops out of the map.
 */
export function setBoundValue(
  bound: BoundValues,
  endpoint: string,
  field: FieldRef,
  value: string,
): BoundValues {
  const others = (bound[endpoint] ?? []).filter((binding) => !isSameField(binding, field));
  const next = value.trim() ? [...others, { in: field.in, name: field.name, value }] : others;
  const result: BoundValues = { ...bound };
  if (next.length > 0) {
    result[endpoint] = next;
  } else {
    delete result[endpoint];
  }
  return result;
}

/**
 * A binding is stale when the loaded spec no longer has its endpoint or field;
 * pwc_tars then withholds that tool until the binding is fixed or removed.
 * Unknown (nothing loaded yet) counts as not stale.
 */
export function isStaleBinding(
  tools: TTarsMcpParsedTool[],
  endpoint: string,
  binding: FieldRef,
): boolean {
  if (tools.length === 0) {
    return false;
  }
  const tool = tools.find((item) => endpointOf(item) === endpoint);
  return tool == null || !(tool.fields ?? []).some((field) => isSameField(binding, field));
}

/** The bound values stored on a server, ignoring anything not shaped like one. */
export function readBoundValues(
  toolConfig: Record<string, unknown> | null | undefined,
): BoundValues {
  const raw = toolConfig?.bound_values;
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const result: BoundValues = {};
  for (const [endpoint, bindings] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(bindings)) {
      continue;
    }
    const valid = bindings.filter(
      (binding): binding is TTarsMcpBoundValue =>
        binding != null &&
        typeof binding === 'object' &&
        typeof (binding as TTarsMcpBoundValue).in === 'string' &&
        typeof (binding as TTarsMcpBoundValue).name === 'string' &&
        typeof (binding as TTarsMcpBoundValue).value === 'string',
    );
    if (valid.length > 0) {
      result[endpoint] = valid;
    }
  }
  return result;
}

/** Bound values as saved: whitespace trimmed, like pwc_tars' own form does. */
export const trimBoundValues = (bound: BoundValues): BoundValues =>
  Object.fromEntries(
    Object.entries(bound).map(([endpoint, bindings]) => [
      endpoint,
      bindings.map((binding) => ({ ...binding, value: binding.value.trim() })),
    ]),
  );

/**
 * The server's `tool_config` to save: everything it already carried (naming
 * options) plus the edited bound values, or none when all were removed.
 */
export function withBoundValues(
  toolConfig: Record<string, unknown> | null | undefined,
  bound: BoundValues,
): Record<string, unknown> {
  const { bound_values: _dropped, ...rest } = toolConfig ?? {};
  const trimmed = trimBoundValues(bound);
  return Object.keys(trimmed).length > 0 ? { ...rest, bound_values: trimmed } : rest;
}

/** The stored static headers as editable rows. */
export function headersToRows(headers: unknown): HeaderRow[] {
  if (headers == null || typeof headers !== 'object' || Array.isArray(headers)) {
    return [];
  }
  return Object.entries(headers as Record<string, unknown>).map(([name, value]) => ({
    name,
    value: value == null ? '' : String(value),
  }));
}

/** Rows folded back into a headers object; a row without a name is dropped. */
export function rowsToHeaders(rows: HeaderRow[]): Record<string, string> {
  return Object.fromEntries(
    rows.filter((row) => row.name.trim() !== '').map((row) => [row.name.trim(), row.value.trim()]),
  );
}

/** Sync counts for the toast; pwc_tars sends `*_count`, older shapes the bare names. */
export const syncCounts = (
  result: TTarsMcpSyncResult | null | undefined,
): { created: number; updated: number; deleted: number } => ({
  created: result?.created_count ?? result?.created ?? 0,
  updated: result?.updated_count ?? result?.updated ?? 0,
  deleted: result?.deleted_count ?? result?.deleted ?? 0,
});

/** `"tool (field, field), tool (field)"` for the blocked-tools warning; empty when none. */
export const blockedToolsSummary = (result: TTarsMcpSyncResult | null | undefined): string =>
  (result?.blocked_tools ?? [])
    .map((tool) => `${tool.name} (${(tool.missing_fields ?? []).join(', ')})`)
    .join(', ');
