import type { TPlugin } from 'librechat-data-provider';
import type { AgentItem } from '../types';
import { getMissingKeyProvider, pluginNeedsAuth } from '../auth';

const base: TPlugin = { name: 'Tool', pluginKey: 'tool' };

describe('pluginNeedsAuth', () => {
  it('returns true when auth fields are declared and not authenticated', () => {
    expect(
      pluginNeedsAuth({
        ...base,
        authConfig: [{ authField: 'API_KEY', label: 'Key', description: '' }],
      }),
    ).toBe(true);
  });

  it('returns false when already authenticated', () => {
    expect(
      pluginNeedsAuth({
        ...base,
        authConfig: [{ authField: 'API_KEY', label: 'Key', description: '' }],
        authenticated: true,
      }),
    ).toBe(false);
  });

  it('returns false when no auth fields are declared', () => {
    expect(pluginNeedsAuth(base)).toBe(false);
    expect(pluginNeedsAuth({ ...base, authConfig: [] })).toBe(false);
  });
});

describe('getMissingKeyProvider', () => {
  it('reads a tool plugin and a builtin, and nothing else', () => {
    const tool: AgentItem = {
      kind: 'tool',
      id: 'image_gen_oai',
      name: 'OpenAI Image Tools',
      description: '',
      iconKey: 'tool',
      plugin: { ...base, missingKeyProvider: 'OpenAI' },
    };
    const builtin: AgentItem = {
      kind: 'builtin',
      id: 'web_search',
      name: 'com_ui_web_search',
      description: '',
      iconKey: 'web_search',
      missingKeyProvider: 'Tavily',
    };
    const action: AgentItem = {
      kind: 'action',
      id: 'a1',
      name: 'Action',
      description: '',
      iconKey: 'action',
      endpointCount: 0,
    };
    expect(getMissingKeyProvider(tool)).toBe('OpenAI');
    expect(getMissingKeyProvider(builtin)).toBe('Tavily');
    expect(getMissingKeyProvider(action)).toBeUndefined();
  });
});
