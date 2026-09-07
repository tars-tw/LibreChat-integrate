import { logger } from '@librechat/data-schemas';
import { Constants } from 'librechat-data-provider';
import type { LCTool, LCToolRegistry } from '@librechat/agents';

/**
 * Providers cap the tools bound to one request (OpenAI: 128 across every
 * source). Mirrors pwc_tars `SysConst.MCP_MAX_TOOLS`: kept below that limit so
 * LibreChat's native tools still fit beside a full MCP set.
 */
const DEFAULT_MCP_MAX_TOOLS = 120;

const LATIN_RUN = /[a-z0-9]+/g;
const CJK_RUN = /[぀-ヿ㐀-䶿一-鿿가-힯]+/g;
const CAMEL_BOUNDARY = /([a-z0-9])([A-Z])/g;
/** Function words that show up in most tool descriptions and would otherwise dominate the overlap. */
const STOPWORDS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'the',
  'of',
  'in',
  'on',
  'at',
  'for',
  'to',
  'and',
  'or',
  'with',
  'by',
  'about',
  'from',
  'as',
  'is',
  'are',
  'be',
  'it',
  'its',
  'this',
  'that',
  'these',
  'those',
  'i',
  'me',
  'my',
  'we',
  'you',
  'your',
  'can',
  'please',
  'help',
  'want',
  'need',
  'do',
  'does',
  'how',
  'what',
  'which',
  'when',
  'all',
  'any',
  'one',
  'some',
  'not',
  'no',
  'if',
  'then',
  'than',
  'into',
  'via',
  'using',
  'use',
  'given',
  'get',
  'set',
]);

interface Scorable {
  name: string;
  description?: string;
}

export interface SelectRelevantToolsParams {
  /** The user message this turn answers; empty or missing falls back to load order. */
  query?: string | null;
  toolDefinitions: LCTool[];
  toolRegistry?: LCToolRegistry;
  maxTools?: number;
  /** Which definitions compete for the cap; everything else is always kept. */
  isCandidate?: (tool: LCTool) => boolean;
}

export interface RelevantToolSelection {
  toolDefinitions: LCTool[];
  toolRegistry?: LCToolRegistry;
  dropped: string[];
}

/** `MCP_MAX_TOOLS`: the most non-deferred MCP tools bound to one turn. */
export function mcpMaxTools(): number {
  const raw = Number(process.env.MCP_MAX_TOOLS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MCP_MAX_TOOLS;
}

/**
 * Latin/digit words plus CJK character bigrams, so a 中文 question can match a
 * 中文 tool description without a segmenter. camelCase is split first so
 * `getUserIssues` yields `user`, `issues` like its snake_case twin.
 */
export function tokenize(text: string): string[] {
  const lowered = text.replace(CAMEL_BOUNDARY, '$1 $2').toLowerCase();
  const tokens = (lowered.match(LATIN_RUN) ?? []).filter((token) => !STOPWORDS.has(token));
  for (const run of lowered.match(CJK_RUN) ?? []) {
    if (run.length === 1) {
      tokens.push(run);
      continue;
    }
    for (let i = 0; i + 1 < run.length; i += 1) {
      tokens.push(run.slice(i, i + 2));
    }
  }
  return tokens;
}

/**
 * IDF-weighted token overlap between the query and each text, so a query word
 * shared by every tool (`get`, `list`, `id`) barely separates them while a
 * word only a few tools mention decides the ranking.
 */
function scoreByOverlap(query: string, texts: string[]): number[] {
  const queryTokens = new Set(tokenize(query));
  if (queryTokens.size === 0) {
    return texts.map(() => 0);
  }
  const tokenSets = texts.map((text) => new Set(tokenize(text)));
  const documentFrequency = new Map<string, number>();
  for (const tokens of tokenSets) {
    for (const token of tokens) {
      if (queryTokens.has(token)) {
        documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
      }
    }
  }
  const corpusSize = texts.length;
  const weightOf = (token: string): number =>
    1 + Math.log((corpusSize + 1) / ((documentFrequency.get(token) ?? 0) + 1));
  return tokenSets.map((tokens) => {
    let score = 0;
    for (const token of queryTokens) {
      if (tokens.has(token)) {
        score += weightOf(token);
      }
    }
    return score;
  });
}

/** Most relevant first; ties keep load order so the ranking is deterministic. */
export function rankToolsByRelevance<T extends Scorable>(query: string, tools: T[]): T[] {
  const scores = scoreByOverlap(
    query,
    tools.map((tool) => `${tool.name}: ${tool.description ?? ''}`),
  );
  return tools
    .map((tool, index) => ({ tool, index, score: scores[index] }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ tool }) => tool);
}

/** Non-deferred MCP definitions are what the provider limit actually counts. */
export function isCappedMcpTool(tool: LCTool): boolean {
  return tool.defer_loading !== true && tool.name.includes(Constants.mcp_delimiter);
}

function pruneRegistry(registry: LCToolRegistry, dropped: ReadonlySet<string>): LCToolRegistry {
  const next: LCToolRegistry = new Map();
  for (const [name, definition] of registry) {
    if (!dropped.has(name)) {
      next.set(name, definition);
    }
  }
  return next;
}

/**
 * Caps the MCP tools bound to one turn the way pwc_tars's `McpToolHost.open`
 * does: everything outside the candidate set is always kept, the candidates
 * are ranked against the user message, and the least relevant overflow is
 * dropped with a warning naming each dropped tool. Retained definitions keep
 * their load order so the bound tool list stays stable between turns.
 */
export function selectRelevantTools({
  query,
  toolDefinitions,
  toolRegistry,
  maxTools = mcpMaxTools(),
  isCandidate = isCappedMcpTool,
}: SelectRelevantToolsParams): RelevantToolSelection {
  const candidates = toolDefinitions.filter(isCandidate);
  if (candidates.length <= maxTools) {
    return { toolDefinitions, toolRegistry, dropped: [] };
  }
  const trimmedQuery = query?.trim() ?? '';
  const kept = new Set(
    rankToolsByRelevance(trimmedQuery, candidates)
      .slice(0, maxTools)
      .map((tool) => tool.name),
  );
  const droppedSet = new Set(
    candidates.filter((tool) => !kept.has(tool.name)).map((tool) => tool.name),
  );
  const dropped = [...droppedSet];
  const basis = trimmedQuery
    ? 'by relevance to the user message'
    : 'in load order (no user message to rank by)';
  logger.warn(
    `[MCP] tool count ${candidates.length} exceeds cap ${maxTools}; kept ${kept.size}, dropped ${dropped.length} ${basis}: ${dropped.join(', ')}`,
  );
  return {
    toolDefinitions: toolDefinitions.filter((tool) => !droppedSet.has(tool.name)),
    toolRegistry: toolRegistry ? pruneRegistry(toolRegistry, droppedSet) : toolRegistry,
    dropped,
  };
}
