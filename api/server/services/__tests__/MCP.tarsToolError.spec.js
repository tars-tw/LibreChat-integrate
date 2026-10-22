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
  it('passes every MCP result and its call id to noteTarsMcpToolCall', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'MCP.js'), 'utf8');
    const callAt = source.indexOf('await mcpManager.callTool(');
    const noteAt = source.indexOf(
      "require('@librechat/api').noteTarsMcpToolCall?.(config?.toolCall?.id, result);",
    );
    expect(callAt).toBeGreaterThan(-1);
    expect(noteAt).toBeGreaterThan(callAt);
    /** Before anything returns the result. */
    expect(source.indexOf('return result', callAt)).toBeGreaterThan(noteAt);
  });

  it('is exported by @librechat/api', () => {
    expect(typeof jest.requireActual('@librechat/api').noteTarsMcpToolCall).toBe('function');
  });
});
