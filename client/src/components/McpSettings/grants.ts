/**
 * One grant's tool scope as the permission editors hold it: `undefined` = not granted,
 * an empty set = the whole server (`mcp_tool_ids: []`), otherwise the granted subset.
 */
export type ToolScope = Set<string> | undefined;

/** The tools a scope grants right now — every tool for a whole-server grant. */
export const grantedToolIds = (scope: ToolScope, allToolIds: string[]): Set<string> => {
  if (scope == null) {
    return new Set();
  }
  return new Set(scope.size === 0 ? allToolIds : scope);
};

export const isToolGranted = (scope: ToolScope, toolId: string): boolean =>
  scope != null && (scope.size === 0 || scope.has(toolId));

/**
 * Checks or unchecks one tool. Every tool checked collapses back to the whole server and
 * none checked to `undefined` — never an empty subset, which would read as the whole server.
 */
export const toggleToolScope = (
  scope: ToolScope,
  allToolIds: string[],
  toolId: string,
  checked: boolean,
): ToolScope => {
  const granted = grantedToolIds(scope, allToolIds);
  if (checked) {
    granted.add(toolId);
  } else {
    granted.delete(toolId);
  }
  if (granted.size === 0) {
    return undefined;
  }
  return granted.size === allToolIds.length ? new Set() : granted;
};
