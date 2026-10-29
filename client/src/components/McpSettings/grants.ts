/**
 * One grant's tool scope as the permission editors hold it: `undefined` = not granted,
 * an empty set = the whole server (`mcp_tool_ids: []`), otherwise the granted subset.
 */
export type ToolScope = Set<string> | undefined;

/** One user's or group's grants: serverId → tool scope (never `undefined`). */
export type Grants = Map<string, Set<string>>;

export type CheckState = boolean | 'indeterminate';

/**
 * The admin's own changes to one server in the principal dialog. They are applied on top
 * of each target's saved grants, so every target keeps what it had and gets the same changes.
 */
export interface ServerEdit {
  /** From the server checkbox: the whole server, or none of it, for every target. */
  server?: boolean;
  /** From single tool checkboxes, applied after `server`: tool id → granted. */
  tools: Map<string, boolean>;
  /** The server's tool ids, known once its list was opened to toggle a tool. */
  toolIds: string[];
}

export type Edits = Map<string, ServerEdit>;

/** The tools a scope grants right now — every tool for a whole-server grant. */
export const grantedToolIds = (scope: ToolScope, allToolIds: string[]): Set<string> => {
  if (scope == null) {
    return new Set();
  }
  return new Set(scope.size === 0 ? allToolIds : scope);
};

/** Unions two grants on one server; a whole-server grant on either side covers the other. */
export const mergeToolScopes = (a: ToolScope, b: ToolScope): ToolScope => {
  if (a == null || b == null) {
    return a ?? b;
  }
  if (a.size === 0 || b.size === 0) {
    return new Set();
  }
  return new Set([...a, ...b]);
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

const serverBase = (own: ToolScope, server: boolean | undefined): ToolScope => {
  if (server == null) {
    return own;
  }
  return server ? new Set() : undefined;
};

/** One target's scope on a server once the admin's edit is applied. */
export const applyServerEdit = (own: ToolScope, edit: ServerEdit | undefined): ToolScope => {
  const base = serverBase(own, edit?.server);
  if (edit == null || edit.tools.size === 0) {
    return base;
  }
  const granted = grantedToolIds(base, edit.toolIds);
  for (const [toolId, isGranted] of edit.tools) {
    if (isGranted) {
      granted.add(toolId);
    } else {
      granted.delete(toolId);
    }
  }
  if (granted.size === 0) {
    return undefined;
  }
  return edit.toolIds.every((toolId) => granted.has(toolId)) ? new Set() : granted;
};

/** A target's grants with every edit applied — what saving writes for that target. */
export const applyEdits = (own: Grants, edits: Edits): Grants => {
  const result: Grants = new Map();
  for (const serverId of new Set([...own.keys(), ...edits.keys()])) {
    const scope = applyServerEdit(own.get(serverId), edits.get(serverId));
    if (scope != null) {
      result.set(serverId, scope);
    }
  }
  return result;
};

/** Every target's scope on one server folded into one, for the row's summary. */
export const unionScope = (scopes: ToolScope[]): ToolScope =>
  scopes.reduce<ToolScope>(mergeToolScopes, undefined);

/** One server across the targets: whole for all → checked, held by none → unchecked. */
export const serverCheckState = (scopes: ToolScope[]): CheckState => {
  if (scopes.length > 0 && scopes.every((scope) => scope?.size === 0)) {
    return true;
  }
  return scopes.some((scope) => scope != null) ? 'indeterminate' : false;
};

/** One tool across the targets: granted to all → checked, to none → unchecked. */
export const toolCheckState = (scopes: ToolScope[], toolId: string): CheckState => {
  const granted = scopes.map((scope) => isToolGranted(scope, toolId));
  if (granted.length > 0 && granted.every(Boolean)) {
    return true;
  }
  return granted.some(Boolean) ? 'indeterminate' : false;
};

/**
 * Whether a click should drop the edit instead of recording `checked`: the click lands on
 * the targets' own state, or — where they differ — cycles from unchecked back to it.
 */
const restoresOwn = (checked: boolean, own: CheckState, current: CheckState): boolean =>
  checked === own || (own === 'indeterminate' && current === false);

/**
 * The server checkbox, for every target at once. A server the targets hold differently
 * cycles mixed → all → none → back to each target's own grants.
 */
export const toggleServerEdit = (
  edits: Edits,
  owns: Grants[],
  serverId: string,
  checked: boolean,
): Edits => {
  const prev = edits.get(serverId);
  const own = serverCheckState(owns.map((grants) => grants.get(serverId)));
  const current = serverCheckState(
    owns.map((grants) => applyServerEdit(grants.get(serverId), prev)),
  );
  const next = new Map(edits);
  if (restoresOwn(checked, own, current)) {
    next.delete(serverId);
  } else {
    next.set(serverId, { server: checked, tools: new Map(), toolIds: prev?.toolIds ?? [] });
  }
  return next;
};

/** One tool checkbox, for every target at once, cycling like the server checkbox. */
export const toggleToolEdit = (
  edits: Edits,
  owns: Grants[],
  serverId: string,
  allToolIds: string[],
  toolId: string,
  checked: boolean,
): Edits => {
  const prev: ServerEdit = {
    ...(edits.get(serverId) ?? { tools: new Map() }),
    toolIds: allToolIds,
  };
  const tools = new Map(prev.tools);
  tools.delete(toolId);
  const stateWith = (edit: ServerEdit) =>
    toolCheckState(
      owns.map((grants) => applyServerEdit(grants.get(serverId), edit)),
      toolId,
    );
  if (!restoresOwn(checked, stateWith({ ...prev, tools }), stateWith(prev))) {
    tools.set(toolId, checked);
  }
  const next = new Map(edits);
  if (prev.server == null && tools.size === 0) {
    next.delete(serverId);
  } else {
    next.set(serverId, { ...prev, tools });
  }
  return next;
};
