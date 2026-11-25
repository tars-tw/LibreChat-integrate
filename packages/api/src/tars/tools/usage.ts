import { logger } from '@librechat/data-schemas';
import type { TarsToolRunConfig } from './progress';
import type { TarsTraceUsage } from '~/tars/trace';
import { createTarsRequestStore } from './store';

/**
 * Tokens each pwc_tars tool call spent on its own model calls, kept per request
 * until the turn is mirrored: pwc_tars counts them in a message's totals, and
 * the chat model's usage does not include them.
 */
const toolUsage = createTarsRequestStore<TarsTraceUsage>((previous, next) => ({
  input_tokens: (previous?.input_tokens ?? 0) + (next.input_tokens ?? 0),
  output_tokens: (previous?.output_tokens ?? 0) + (next.output_tokens ?? 0),
}));

/** Where a request's tool usage goes once the turn has taken it (see {@link takeTarsToolUsage}). */
const lateUsage = new WeakMap<object, (usage: TarsTraceUsage) => void>();

export function recordTarsToolUsage(
  owner: object,
  toolCallId: string,
  tokens: { prompt?: number; completion?: number } | null | undefined,
): void {
  const input = Number(tokens?.prompt) || 0;
  const output = Number(tokens?.completion) || 0;
  if (input <= 0 && output <= 0) {
    return;
  }
  const usage = { input_tokens: input, output_tokens: output };
  const late = owner != null && typeof owner === 'object' ? lateUsage.get(owner) : undefined;
  if (late == null) {
    toolUsage.record(owner, toolCallId, usage);
    return;
  }
  /** Runs inside the tool call: a reporting error must not fail the tool. */
  try {
    late(usage);
  } catch (error) {
    logger.warn('[tars-usage] Could not hand on a tool call’s late usage', error);
  }
}

/**
 * {@link recordTarsToolUsage} for one tool invocation, keyed by the call id the
 * agents run passes in its config. A tool built without an owner (no mirror to
 * hand the usage to) records nothing.
 */
export function recordTarsCallUsage(
  owner: object | null | undefined,
  config: TarsToolRunConfig | null | undefined,
  tokens: { prompt?: number; completion?: number } | null | undefined,
): void {
  const toolCallId = config?.toolCall?.id;
  if (owner && toolCallId) {
    recordTarsToolUsage(owner, toolCallId, tokens);
  }
}

/** The usage kept for this request, by the id of the tool call that spent it. */
export function getTarsToolUsage(owner: object | null | undefined): Map<string, TarsTraceUsage> {
  return toolUsage.get(owner);
}

/**
 * Hands the usage this request's tool calls recorded to the mirror or report that carries the
 * turn. A call still running then (dispatched in the background, or by a detached subagent)
 * records after the turn is gone; `late` gets each such record instead of a store nobody reads
 * again. A second take finds nothing left, so nothing is counted twice; its `late` replaces the first.
 */
export function takeTarsToolUsage(
  owner: object | null | undefined,
  late: (usage: TarsTraceUsage) => void,
): Map<string, TarsTraceUsage> {
  const taken = toolUsage.take(owner);
  if (owner != null && typeof owner === 'object') {
    lateUsage.set(owner, late);
  }
  return taken;
}
