import {
  TARS_MCP_SHARE_BLOCKED,
  TARS_MCP_PUBLIC_SHARE_BLOCKED,
  TARS_MCP_SHARE_CHECK_UNAVAILABLE,
} from 'librechat-data-provider';
import { agentSaveShareError, mcpShareBlocks, permissionErrorKey } from '../errors';

const withCode = (code: string) => ({ response: { data: { code } } });

describe('permissionErrorKey', () => {
  it.each([
    ['RESOURCE_PERMISSIONS_BUSY', 'com_ui_permissions_busy'],
    ['RESOURCE_PERMISSIONS_UNAVAILABLE', 'com_ui_permissions_unavailable'],
    ['PERMISSION_AUDIT_UNAVAILABLE', 'com_ui_permissions_audit_unavailable'],
    [TARS_MCP_SHARE_BLOCKED, 'com_ui_tars_mcp_share_blocked'],
    [TARS_MCP_PUBLIC_SHARE_BLOCKED, 'com_ui_tars_mcp_share_public_blocked'],
    [TARS_MCP_SHARE_CHECK_UNAVAILABLE, 'com_ui_tars_mcp_share_check_unavailable'],
  ])('maps %s to an actionable message', (code, key) => {
    expect(permissionErrorKey(withCode(code))).toBe(key);
  });

  it.each([withCode('SOMETHING_ELSE'), new Error('x'), null, undefined])(
    'falls back to the generic failure for %p',
    (error) => {
      expect(permissionErrorKey(error)).toBe('com_ui_permissions_failed_update');
    },
  );
});

describe('mcpShareBlocks', () => {
  it('reads who was refused, and nothing from any other failure', () => {
    const blocked = [{ name: 'Amy' }];

    expect(mcpShareBlocks({ response: { data: { blocked } } })).toBe(blocked);
    expect(mcpShareBlocks(withCode('SOMETHING_ELSE'))).toEqual([]);
    expect(mcpShareBlocks(new Error('x'))).toEqual([]);
  });
});

describe('agentSaveShareError', () => {
  const localize = (key: string, values?: Record<string, string>) =>
    values ? `${key}:${values.names}` : key;

  it('names everyone holding the save back', () => {
    const error = {
      response: {
        data: { code: TARS_MCP_SHARE_BLOCKED, blocked: [{ name: 'Amy' }, { name: 'UAT' }] },
      },
    };

    expect(agentSaveShareError(error, localize)).toBe('com_ui_tars_mcp_save_blocked:Amy, UAT');
  });

  it.each([
    [TARS_MCP_PUBLIC_SHARE_BLOCKED, 'com_ui_tars_mcp_save_public_blocked'],
    [TARS_MCP_SHARE_CHECK_UNAVAILABLE, 'com_ui_tars_mcp_share_check_unavailable'],
  ])('explains %s', (code, key) => {
    expect(agentSaveShareError(withCode(code), localize)).toBe(key);
  });

  it('leaves other failures to the caller', () => {
    expect(agentSaveShareError(new Error('x'), localize)).toBeNull();
  });
});
