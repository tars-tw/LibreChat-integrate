import { TARS_SWITCH_TOOLS } from 'librechat-data-provider';
import type { TTarsToolSwitch } from 'librechat-data-provider';

/**
 * pwc_tars's switches presented as builtins. Unlike the capability builtins they
 * have no form field: a saved agent persists the tools a switch mounts in
 * `agent.tools`, the same set the chat switch puts on a turn.
 */
export function isTarsSwitchId(id: string): id is TTarsToolSwitch {
  return Object.prototype.hasOwnProperty.call(TARS_SWITCH_TOOLS, id);
}

/** A switch counts as on while the agent carries any of its tools, so a partial set stays removable. */
export function isTarsSwitchSelected(tools: readonly string[], id: TTarsToolSwitch): boolean {
  return TARS_SWITCH_TOOLS[id].some((tool) => tools.includes(tool));
}

/** `agent.tools` with one switch's tools added or removed; the other switches are untouched. */
export function toggleTarsSwitchTools(
  tools: readonly string[],
  id: TTarsToolSwitch,
  enable: boolean,
): string[] {
  const own = new Set<string>(TARS_SWITCH_TOOLS[id]);
  const rest = tools.filter((tool) => !own.has(tool));
  return enable ? [...rest, ...own] : rest;
}
