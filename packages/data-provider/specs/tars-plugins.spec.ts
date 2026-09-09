import {
  tarsPluginToolName,
  isTarsPluginToolName,
  tarsPluginFunctionKey,
  parseTarsPluginFunctions,
  mergeTarsPluginFunctions,
  enabledTarsPluginFunctions,
  tarsPluginNameFromToolName,
  TARS_PLUGIN_FUNCTION_KIND,
} from '../src/tars';

describe('tars plugin tool names', () => {
  it('round-trips the plugin name through the LibreChat tool name', () => {
    expect(tarsPluginToolName('text_stats')).toBe('tars_plugin_text_stats');
    expect(isTarsPluginToolName('tars_plugin_text_stats')).toBe(true);
    expect(tarsPluginNameFromToolName('tars_plugin_text_stats')).toBe('text_stats');
  });

  it('does not claim other tools or the bare prefix', () => {
    expect(isTarsPluginToolName('sql_agent')).toBe(false);
    expect(isTarsPluginToolName('tars_plugin_')).toBe(false);
    expect(isTarsPluginToolName(undefined)).toBe(false);
    expect(tarsPluginNameFromToolName('search_mcp_tars_issues')).toBeUndefined();
  });

  it('keys domain_functions entries with the pwc_tars prefix', () => {
    expect(tarsPluginFunctionKey('text_stats')).toBe('plugin:text_stats');
  });
});

describe('parseTarsPluginFunctions', () => {
  const stored = JSON.stringify({
    web_search: { enabled: true, default_value: true },
    'plugin:text_stats': {
      kind: 'plugin',
      name: 'text_stats',
      enabled: true,
      default_value: true,
      display_name: 'Text Stats',
      description: 'Count words.',
    },
    'plugin:summarize_text': { enabled: false, default_value: true },
    'plugin:': { enabled: true },
    'plugin:broken': 'nope',
  });

  it('returns only plugin entries, tolerating entries written without the kind marker', () => {
    expect(parseTarsPluginFunctions(stored)).toEqual([
      {
        kind: TARS_PLUGIN_FUNCTION_KIND,
        name: 'text_stats',
        enabled: true,
        default_value: true,
        display_name: 'Text Stats',
        description: 'Count words.',
      },
      {
        kind: TARS_PLUGIN_FUNCTION_KIND,
        name: 'summarize_text',
        enabled: false,
        default_value: false,
        display_name: 'summarize_text',
        description: '',
      },
    ]);
  });

  it('offers only the enabled plugins in chat', () => {
    expect(enabledTarsPluginFunctions(stored).map((entry) => entry.name)).toEqual(['text_stats']);
  });

  it('is empty for missing or malformed blocks', () => {
    expect(parseTarsPluginFunctions(null)).toEqual([]);
    expect(parseTarsPluginFunctions('{not json')).toEqual([]);
    expect(parseTarsPluginFunctions('[1]')).toEqual([]);
  });
});

describe('mergeTarsPluginFunctions', () => {
  const tools = [
    { name: 'text_stats', display_name: 'Text Stats', description: 'Count words.', ok: true },
    { name: 'summarize_text', display_name: 'Summarize Text', ok: true },
    { name: 'broken_tool', display_name: 'Broken', ok: false },
  ];

  it('keeps built-in keys, rewrites every plugin entry, and skips invalid tools', () => {
    const existing = JSON.stringify({
      web_search: { enabled: true, default_value: false },
      model_settings: { default_model: 'gpt-5.4-mini', available_models: [] },
      'plugin:removed_tool': { kind: 'plugin', name: 'removed_tool', enabled: true },
    });
    const merged = JSON.parse(
      mergeTarsPluginFunctions(existing, tools, {
        text_stats: { enabled: true, default_value: true },
        summarize_text: { enabled: false, default_value: true },
        broken_tool: { enabled: true, default_value: true },
      }),
    );
    expect(merged.web_search).toEqual({ enabled: true, default_value: false });
    expect(merged.model_settings).toEqual({ default_model: 'gpt-5.4-mini', available_models: [] });
    expect(merged['plugin:removed_tool']).toBeUndefined();
    expect(merged['plugin:broken_tool']).toBeUndefined();
    expect(merged['plugin:text_stats']).toEqual({
      kind: 'plugin',
      name: 'text_stats',
      enabled: true,
      default_value: true,
      display_name: 'Text Stats',
      description: 'Count words.',
    });
    expect(merged['plugin:summarize_text']).toEqual({
      kind: 'plugin',
      name: 'summarize_text',
      enabled: false,
      default_value: false,
      display_name: 'Summarize Text',
      description: '',
    });
  });

  it('writes plugins switched off when no state is given', () => {
    const merged = JSON.parse(mergeTarsPluginFunctions(null, tools.slice(0, 1), {}));
    expect(merged['plugin:text_stats'].enabled).toBe(false);
  });
});
