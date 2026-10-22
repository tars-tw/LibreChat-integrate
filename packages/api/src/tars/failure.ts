/**
 * How TARS tools tell the model a call failed. They answer in text rather than
 * throwing, so the model can read why and carry on, which also means the agents
 * run marks the step completed (LibreChat's MCP client drops `isError` as well).
 * The execution trace recognizes a failure by these openings, so every TARS tool
 * builds its failure text from here rather than writing its own.
 */

/** Opens every "this account is not linked to pwc_tars" answer. */
export const TARS_NOT_LINKED = 'This LibreChat account is not linked to pwc_tars';

const FAILURE_SUBJECTS = [
  'TARS tool call',
  'The knowledge base search',
  'Chart generation',
  'The table task',
  'The database query',
  'The data query',
  'The TARS agent',
] as const;

export type TarsToolFailureSubject = (typeof FAILURE_SUBJECTS)[number];

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const FAILURE_PATTERN = new RegExp(
  `^(?:${[...FAILURE_SUBJECTS.map(escapeRegExp), 'The (?:plugin )?tool "[^"\\n]+"'].join('|')}) failed: `,
);

export function tarsToolFailureText(subject: TarsToolFailureSubject, error: string): string {
  return `${subject} failed: ${error}`;
}

/** A pwc_tars built-in tool, named by its LibreChat tool name. */
export function tarsBuiltinToolFailureText(toolName: string, error: string): string {
  return `The tool "${toolName}" failed: ${error}`;
}

/** A pwc_tars plugin tool, named by its display name. */
export function tarsPluginToolFailureText(displayName: string, error: string): string {
  return `The plugin tool "${displayName}" failed: ${error}`;
}

/** True when a tool's output is one of the failure answers above. */
export function isTarsToolFailureOutput(output: unknown): boolean {
  return (
    typeof output === 'string' &&
    (output.startsWith(TARS_NOT_LINKED) || FAILURE_PATTERN.test(output))
  );
}

/**
 * MCP results the server marked `isError`. LibreChat's MCP client formats a
 * result into `[text, artifacts]` and drops the flag, and the tool layer that
 * knows the call's id never sees the raw result, so the flag rides on the
 * formatted result from `MCPManager.callTool` to `MCP.js`.
 */
const failedMcpResults = new WeakSet<object>();

/** Notes that a formatted MCP result came from an `isError` response. */
export function noteTarsMcpToolError(
  formatted: unknown,
  raw: { isError?: unknown } | null | undefined,
): void {
  if (raw?.isError === true && formatted != null && typeof formatted === 'object') {
    failedMcpResults.add(formatted);
  }
}

/** The turn a tool call ran in: the run configurable's `user_id` and `thread_id`. */
export interface TarsToolCallScope {
  user_id?: unknown;
  thread_id?: unknown;
}

/**
 * Tool calls whose MCP server reported an error, by the user and conversation
 * they ran in. The tool layer holds neither the request nor the mirror's input,
 * only the run configurable, and these two are what both sides know. The
 * mirror takes a conversation's ids once it has read them, so a provider that
 * reuses call ids (`call_0`) never marks a later turn's call; turns never
 * mirrored (temporary chats) are bounded by dropping the oldest conversation.
 */
const failedToolCalls = new Map<string, Set<string>>();
const FAILED_SCOPE_LIMIT = 1_000;

const scopeKey = (userId: unknown, conversationId: unknown): string | null =>
  typeof userId === 'string' && userId && typeof conversationId === 'string' && conversationId
    ? `${userId}\u0000${conversationId}`
    : null;

/** Records the call as failed when its formatted result was noted as an error. */
export function noteTarsMcpToolCall(
  toolCallId: string | null | undefined,
  formatted: unknown,
  scope: TarsToolCallScope | null | undefined,
): void {
  const key = scopeKey(scope?.user_id, scope?.thread_id);
  if (!toolCallId || !key) {
    return;
  }
  if (formatted == null || typeof formatted !== 'object' || !failedMcpResults.has(formatted)) {
    return;
  }
  const calls = failedToolCalls.get(key) ?? new Set<string>();
  calls.add(toolCallId);
  failedToolCalls.delete(key);
  failedToolCalls.set(key, calls);
  if (failedToolCalls.size > FAILED_SCOPE_LIMIT) {
    const oldest = failedToolCalls.keys().next().value;
    if (oldest != null) {
      failedToolCalls.delete(oldest);
    }
  }
}

/** The conversation's failed MCP calls since it was last mirrored; reading them clears them. */
export function takeTarsFailedToolCalls(
  userId: string | null | undefined,
  conversationId: string | null | undefined,
): ReadonlySet<string> {
  const key = scopeKey(userId, conversationId);
  const calls = (key && failedToolCalls.get(key)) || new Set<string>();
  if (key) {
    failedToolCalls.delete(key);
  }
  return calls;
}

/**
 * What the agents SDK's ToolNode hands the model when a tool threw or was cut
 * off by a Stop (`tools/toolErrorContent`), or was blocked by policy or got
 * unparseable arguments (`ToolNode` itself); none of these is exported. The
 * step still closes as `completed`, so the trace knows these only by their text.
 */
const SDK_TOOL_ERROR_PATTERNS = [
  /^Error: [\s\S]*\n Please fix your mistakes\./,
  /^Error: [\s\S]*the tool was not run\./,
  /^Blocked: /,
  /^STOP\. The user doesn't want to proceed with this tool use\./,
];

/** True when a tool's output is the agents SDK's own failure answer. */
export function isSdkToolErrorOutput(output: unknown): boolean {
  return (
    typeof output === 'string' && SDK_TOOL_ERROR_PATTERNS.some((pattern) => pattern.test(output))
  );
}
