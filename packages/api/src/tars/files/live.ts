import { GraphEvents } from '@librechat/agents';
import { Tools } from 'librechat-data-provider';
import { logger } from '@librechat/data-schemas';
import type { EventHandler, ToolExecuteResult, ToolExecuteBatchRequest } from '@librechat/agents';
import type { TarsGeneratedLink, StoredTarsTrace } from './generated';
import { linksOfTarsTrace, toTarsGeneratedLink, buildTarsGeneratedFilesContext } from './generated';

/**
 * The `AgentContext` fields this module touches. `additionalInstructions` is
 * public; `systemRunnableStale` is private in `@librechat/agents`, and is
 * what makes the next model call rebuild the system prompt (and recount its
 * tokens) instead of reusing the cached one.
 */
interface LiveAgentContext {
  additionalInstructions?: string;
  systemRunnableStale?: boolean;
}

/** The graph surface an event handler is handed. */
interface LiveGraph {
  getAgentContext?: (metadata: Record<string, unknown>) => unknown;
}

/** What this module last appended to one agent's instructions, and the links it named. */
interface TurnState {
  block: string;
  links: TarsGeneratedLink[];
}

const turnByContext = new WeakMap<object, TurnState>();

function isLiveAgentContext(value: unknown): value is LiveAgentContext & object {
  return (
    value != null &&
    typeof value === 'object' &&
    'systemRunnableStale' in value &&
    (!('additionalInstructions' in value) ||
      value.additionalInstructions == null ||
      typeof value.additionalInstructions === 'string')
  );
}

/** The links a finished tool's `tars_trace` artifact carries; none for any other tool. */
function linksOfToolOutput(output: unknown): TarsGeneratedLink[] {
  if (output == null || typeof output !== 'object' || !('artifact' in output)) {
    return [];
  }
  const artifact = (output as { artifact?: Record<string, unknown> | null }).artifact;
  const trace = artifact?.[Tools.tars_trace] as StoredTarsTrace | undefined;
  return linksOfTarsTrace(trace)
    .map(toTarsGeneratedLink)
    .filter((link): link is TarsGeneratedLink => link != null);
}

/**
 * Lists the charts and files a TARS tool just generated in the running
 * agent's instructions, so a summarization or pruning later in the same turn
 * cannot take them from the model. The turn-start list only knows saved
 * replies; this covers the reply still being written. Every link of the turn
 * stays listed (the answer being written may need any of them), so the turn's
 * tool calls are the only bound.
 *
 * Never throws. A no-op for every other tool, for a link the instructions
 * already name, and when `@librechat/agents` no longer has the fields it
 * relies on.
 */
export function refreshTarsTurnGeneratedLinks(
  output: unknown,
  metadata: Record<string, unknown> | undefined,
  graph: LiveGraph | undefined,
): void {
  if (!metadata || typeof graph?.getAgentContext !== 'function') {
    return;
  }
  try {
    const links = linksOfToolOutput(output);
    if (links.length === 0) {
      return;
    }
    const context = graph.getAgentContext(metadata);
    if (!isLiveAgentContext(context)) {
      logger.warn('[tars-files] Agent context lacks the fields to list generated links');
      return;
    }
    const state = turnByContext.get(context) ?? { block: '', links: [] };
    const current = context.additionalInstructions ?? '';
    const base = state.block ? current.replace(`\n${state.block}`, '') : current;
    const known = new Set(state.links.map((link) => link.url));
    const fresh = links.filter((link) => {
      if (known.has(link.url) || base.includes(link.url)) {
        return false;
      }
      known.add(link.url);
      return true;
    });
    if (fresh.length === 0) {
      return;
    }
    const turnLinks = [...state.links, ...fresh];
    const block = buildTarsGeneratedFilesContext(turnLinks, 'turn') ?? '';
    context.additionalInstructions = `${base}\n${block}`;
    context.systemRunnableStale = true;
    turnByContext.set(context, { block, links: turnLinks });
  } catch (error) {
    logger.warn('[tars-files] Could not list the generated links for this turn', error);
  }
}

function isToolExecuteBatch(data: unknown): data is ToolExecuteBatchRequest {
  return (
    data != null &&
    typeof data === 'object' &&
    'resolve' in data &&
    typeof data.resolve === 'function'
  );
}

function withTarsGeneratedLinks(handler: EventHandler): EventHandler {
  return {
    handle: (event, data, metadata, graph) => {
      if (!isToolExecuteBatch(data)) {
        return handler.handle(event, data, metadata, graph);
      }
      const resolve = (results: ToolExecuteResult[]): void => {
        for (const result of results) {
          if (result.status === 'success') {
            refreshTarsTurnGeneratedLinks(result, data.metadata, graph);
          }
        }
        data.resolve(results);
      };
      return handler.handle(event, { ...data, resolve }, metadata, graph);
    },
  };
}

/**
 * Wraps the map's `ON_TOOL_EXECUTE` handler, when it has one, so the links of
 * each TARS call that succeeded are listed before its batch settles, ahead of
 * the next model call and any summarization. Event-driven calls (every chat
 * tool) never emit `on_tool_end`, and a content-filtered result settles as an
 * error without its artifact, so only successful results are read.
 */
export function attachTarsGeneratedLinks(handlers: Record<string, EventHandler | undefined>): void {
  const handler = handlers[GraphEvents.ON_TOOL_EXECUTE];
  if (handler) {
    handlers[GraphEvents.ON_TOOL_EXECUTE] = withTarsGeneratedLinks(handler);
  }
}
