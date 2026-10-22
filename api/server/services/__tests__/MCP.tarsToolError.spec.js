/**
 * TARS seam guard for `MCP.js`: the MCP tool instance hands each result to
 * `noteTarsMcpToolCall` with the call's id, so an MCP `isError` reaches the
 * pwc_tars audit trace as a failed call. The tool instance needs the whole
 * MCP.spec.js harness to run, so this guards the source instead: it fails when
 * a rebase drops the standalone line that follows `mcpManager.callTool`.
 */
const fs = require('fs');
const path = require('path');

describe('TARS isError seam in MCP.js', () => {
  it('passes every MCP result, its call id and the run configurable to noteTarsMcpToolCall', () => {
    /** Whitespace dropped, so Prettier wrapping the call does not fail the guard. */
    const source = fs
      .readFileSync(path.join(__dirname, '..', 'MCP.js'), 'utf8')
      .replace(/\s+/g, '');
    const callAt = source.indexOf('awaitmcpManager.callTool(');
    const noteAt = source.indexOf(
      "require('@librechat/api').noteTarsMcpToolCall?.(config?.toolCall?.id,result,config?.configurable,);",
    );
    expect(callAt).toBeGreaterThan(-1);
    expect(noteAt).toBeGreaterThan(callAt);
    /** Before anything returns the result. */
    expect(source.indexOf('returnresult', callAt)).toBeGreaterThan(noteAt);
  });

  it('is exported by @librechat/api', () => {
    expect(typeof jest.requireActual('@librechat/api').noteTarsMcpToolCall).toBe('function');
  });
});
