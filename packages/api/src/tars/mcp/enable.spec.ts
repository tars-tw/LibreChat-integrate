import type { TarsMcpUserServer } from './user';
import { enableUpdateFor } from './enable';

const setting = (overrides: Partial<TarsMcpUserServer> = {}): TarsMcpUserServer => ({
  id: 's-github',
  name: 'Github-repo',
  type: 'external',
  is_enabled: true,
  user_enabled: false,
  requires_user_credentials: false,
  has_credentials: false,
  auth_type: 'none',
  login_fields: [],
  tool_config: {},
  tools: [
    { id: 't-list', name: 'list_repos', user_enabled: true },
    { id: 't-file', name: 'get_file', user_enabled: true },
  ],
  ...overrides,
});

const WHOLE = { mcp_server_id: 's-github', mcp_tool_ids: [] };
const ONLY_LIST = { mcp_server_id: 's-github', mcp_tool_ids: ['t-list'] };

describe('enableUpdateFor', () => {
  it('turns on a server that is off, leaving the tool switches alone', () => {
    expect(enableUpdateFor(setting(), WHOLE)).toEqual({ is_enabled: true });
  });

  it('changes nothing on a server already on with every bound tool on', () => {
    const on = setting({ user_enabled: true, tool_config: { get_file: false } });
    expect(enableUpdateFor(on, ONLY_LIST)).toBeNull();
  });

  it('keeps a server off while it waits for credentials only the user can give', () => {
    expect(enableUpdateFor(setting({ requires_user_credentials: true }), WHOLE)).toBeNull();
  });

  it('keeps a credentialed server off even once the user has saved theirs', () => {
    const saved = setting({ requires_user_credentials: true, has_credentials: true });
    expect(enableUpdateFor(saved, WHOLE)).toBeNull();
  });

  it('turns the bound tools back on and keeps the other switches', () => {
    const off = setting({
      user_enabled: true,
      tool_config: { list_repos: false, get_file: false, search: true },
    });
    expect(enableUpdateFor(off, ONLY_LIST)).toEqual({
      is_enabled: true,
      tool_config: { get_file: false, search: true },
    });
  });

  it('turns every tool back on for a whole-server binding', () => {
    const off = setting({ tool_config: { list_repos: false, get_file: true } });
    expect(enableUpdateFor(off, WHOLE)).toEqual({
      is_enabled: true,
      tool_config: { get_file: true },
    });
  });

  it('sends only the switch when pwc_tars reports no tool_config', () => {
    expect(enableUpdateFor(setting({ tool_config: undefined }), ONLY_LIST)).toEqual({
      is_enabled: true,
    });
  });
});
