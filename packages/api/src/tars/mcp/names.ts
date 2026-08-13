import { logger } from '@librechat/data-schemas';
import { Constants, tarsMcpServerName } from 'librechat-data-provider';

/**
 * OpenAI rejects `function.name` over 64 characters, and LibreChat's final
 * tool key is `<gateway tool name>_mcp_<entry name>` — the whole combined key
 * must fit, so the budget for the tool half shrinks by the entry name.
 */
export const PROVIDER_TOOL_NAME_LIMIT = 64;

/**
 * The entry name {@link withTarsMcpConfig} actually injected for each pwc_tars
 * server id. Derivation alone is not reproducible elsewhere — the collision
 * suffix depends on the whole server list plus any pre-existing YAML entries —
 * so every consumer that needs a server's chat-facing name must read it from
 * here instead of re-deriving it.
 */
const injectedEntryNames = new Map<string, string>();

/** Resets the registry; called at the start of every injection run. */
export function clearTarsMcpEntryNames(): void {
  injectedEntryNames.clear();
}

/** Records the entry name injection chose for a pwc_tars server id. */
export function recordTarsMcpEntryName(serverId: string, entryName: string): void {
  injectedEntryNames.set(serverId, entryName);
}

/** The injected `mcpConfig` entry name for a pwc_tars server id, if it was injected. */
export function tarsMcpEntryName(serverId: string): string | undefined {
  return injectedEntryNames.get(serverId);
}

/** Whether injection has run and produced entries; `false` means callers must fall back to derivation. */
export function hasTarsMcpEntryNames(): boolean {
  return injectedEntryNames.size > 0;
}

/**
 * The chat-facing `mcpConfig` entry name for a pwc_tars server. Reads the name
 * injection actually used (the only place the collision suffix is known);
 * derivation is the fallback for before/without a successful injection, and
 * `null` means the server has no chat entry at all, so callers must drop it
 * rather than advertise a name nothing will match.
 */
export function gatewayNameFor(serverId: string, serverCode?: string | null): string | null {
  const injected = tarsMcpEntryName(serverId);
  if (injected != null) {
    return injected;
  }
  if (hasTarsMcpEntryNames()) {
    return null;
  }
  return derivedTarsMcpEntryName(serverId, serverCode);
}

/** Derivation-only entry name, for budget math when a server has no chat entry. */
export function derivedTarsMcpEntryName(serverId: string, serverCode?: string | null): string {
  return tarsMcpServerName(serverCode?.trim() || serverId.slice(0, 8));
}

/** Deterministic djb2-style hash in base36 — stable across processes and restarts. */
function shortHash(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

/**
 * Fits a gateway tool name into the provider budget left after LibreChat
 * appends `_mcp_<entryName>`. Over-budget names keep a head slice plus a
 * deterministic hash of the full name, so they stay unique within a server
 * and identical across restarts (they persist in conversation history and
 * agent tool bindings).
 */
export function fitToolName(name: string, entryName: string): string {
  const budget = PROVIDER_TOOL_NAME_LIMIT - Constants.mcp_delimiter.length - entryName.length;
  if (name.length <= budget) {
    return name;
  }
  const hash = shortHash(name);
  const head = Math.max(1, budget - hash.length - 1);
  const fitted = `${name.slice(0, head)}_${hash}`;
  if (fitted.length > budget) {
    logger.warn(
      `[tars-mcp] Entry name "${entryName}" leaves too little room for tool names; ` +
        `"${fitted}" still exceeds the ${PROVIDER_TOOL_NAME_LIMIT}-char provider limit. ` +
        'Shorten the pwc_tars server code.',
    );
  }
  return fitted;
}
