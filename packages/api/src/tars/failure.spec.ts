import fs from 'fs';
import path from 'path';
import {
  TARS_NOT_LINKED,
  isSdkToolErrorOutput,
  noteTarsMcpToolCall,
  isTarsFailedToolCall,
  noteTarsMcpToolError,
  tarsToolFailureText,
  isTarsToolFailureOutput,
  tarsBuiltinToolFailureText,
  tarsPluginToolFailureText,
} from './failure';

describe('isTarsToolFailureOutput', () => {
  it('recognizes every failure answer the TARS tools give', () => {
    const failures = [
      tarsToolFailureText(
        'TARS tool call',
        'pwc_tars request to /api/mcp/execute returned status 500',
      ),
      tarsToolFailureText('The knowledge base search', 'timeout'),
      tarsToolFailureText('Chart generation', 'bad spec'),
      tarsToolFailureText('The table task', 'no files'),
      tarsToolFailureText('The database query', 'timeout'),
      tarsToolFailureText('The data query', 'file gone'),
      tarsToolFailureText('The TARS agent', 'status 500'),
      tarsBuiltinToolFailureText('tars_sql_query', 'syntax error'),
      tarsPluginToolFailureText('摘要工具', 'timeout'),
      `${TARS_NOT_LINKED}.`,
      `${TARS_NOT_LINKED}, so TARS tools cannot run.`,
    ];
    for (const output of failures) {
      expect(isTarsToolFailureOutput(output)).toBe(true);
    }
  });

  /** These are the exact texts stored before the helpers existed. */
  it('keeps the wording the tools already used', () => {
    expect(tarsToolFailureText('TARS tool call', 'x')).toBe('TARS tool call failed: x');
    expect(tarsToolFailureText('The database query', 'x')).toBe('The database query failed: x');
    expect(tarsToolFailureText('The data query', 'x')).toBe('The data query failed: x');
    expect(tarsToolFailureText('The TARS agent', 'x')).toBe('The TARS agent failed: x');
    expect(tarsBuiltinToolFailureText('tars_sql_query', 'x')).toBe(
      'The tool "tars_sql_query" failed: x',
    );
  });

  it('does not flag ordinary output that merely mentions a failure', () => {
    for (const output of [
      'The build failed: see log',
      'Results:\nTARS tool call failed: quoted in a document',
      '',
      undefined,
      { error: 'x' },
    ]) {
      expect(isTarsToolFailureOutput(output)).toBe(false);
    }
  });
});

describe('MCP isError tracking', () => {
  it('fails the call whose formatted result came from an isError response', () => {
    const failed: [string, undefined] = ['upstream 500', undefined];
    const fine: [string, undefined] = ['ok', undefined];
    noteTarsMcpToolError(failed, { isError: true });
    noteTarsMcpToolError(fine, { isError: false });

    noteTarsMcpToolCall('mcp-1', failed);
    noteTarsMcpToolCall('mcp-2', fine);
    noteTarsMcpToolCall(undefined, failed);

    expect(isTarsFailedToolCall('mcp-1')).toBe(true);
    expect(isTarsFailedToolCall('mcp-2')).toBe(false);
    expect(isTarsFailedToolCall(undefined)).toBe(false);
  });

  it('ignores results that are not objects', () => {
    noteTarsMcpToolError('text', { isError: true });
    noteTarsMcpToolCall('mcp-3', 'text');
    expect(isTarsFailedToolCall('mcp-3')).toBe(false);
  });

  /** Nothing removes a read id, so the process-wide set must stay bounded. */
  it('keeps only the newest failed calls, dropping the oldest first', () => {
    const failed: [string, undefined] = ['upstream 500', undefined];
    noteTarsMcpToolError(failed, { isError: true });
    noteTarsMcpToolCall('evict-first', failed);
    for (let i = 0; i < 10_000; i++) {
      noteTarsMcpToolCall(`evict-${i}`, failed);
    }
    expect(isTarsFailedToolCall('evict-first')).toBe(false);
    expect(isTarsFailedToolCall('evict-9999')).toBe(true);
  });
});

describe('isSdkToolErrorOutput', () => {
  it('recognizes what the agents SDK answers for a failed tool', () => {
    for (const output of [
      'Error: connect ECONNREFUSED 10.0.0.1:443\n Please fix your mistakes.',
      'Error: Malformed tool call arguments. The tool call input could not be parsed as a JSON object; the tool was not run.',
      'Blocked: tool not allowed for this agent',
      "STOP. The user doesn't want to proceed with this tool use. The run was stopped; the tool may not have completed.",
    ]) {
      expect(isSdkToolErrorOutput(output)).toBe(true);
    }
  });

  it('does not flag output that only mentions an error', () => {
    for (const output of ['Error rate: 3%', 'No errors found.', 'Error: none', undefined]) {
      expect(isSdkToolErrorOutput(output)).toBe(false);
    }
  });

  /** The formats are the SDK's own and not exported; an upgrade that rewords them fails here. */
  it('matches the wording the installed agents SDK still uses', () => {
    const tools = path.join(path.dirname(require.resolve('@librechat/agents')), 'tools');
    const errorContent = fs.readFileSync(path.join(tools, 'toolErrorContent.cjs'), 'utf8');
    expect(errorContent).toContain('Please fix your mistakes.');
    expect(errorContent).toContain("STOP. The user doesn't want to proceed with this tool use.");

    const toolNode = fs.readFileSync(path.join(tools, 'ToolNode.cjs'), 'utf8');
    expect(toolNode).toContain('`Blocked: ${reason}`');
    expect(toolNode).toContain('the tool was not run.');
  });
});
