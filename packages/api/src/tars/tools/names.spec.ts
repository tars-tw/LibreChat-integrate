import { AgentCapabilities } from 'librechat-data-provider';
import { tarsToolsForToggles, withTarsSpreadsheetTools, tarsBuiltinToolCapability } from './names';

describe('tarsToolsForToggles', () => {
  it('mounts nothing when no pwc_tars switch is on', () => {
    expect(tarsToolsForToggles(undefined)).toEqual([]);
    expect(tarsToolsForToggles({ rag_agent: false })).toEqual([]);
  });

  it('mounts each switch as its own pwc_tars tools, file generation included only by its switch', () => {
    expect(tarsToolsForToggles({ rag_agent: true })).toEqual(['tars_knowledge_search']);
    expect(tarsToolsForToggles({ file_agent: true })).toEqual(['tars_generate_file']);
    expect(
      tarsToolsForToggles({
        rag_agent: true,
        sql_agent: true,
        chart_agent: true,
        file_agent: true,
      }),
    ).toEqual([
      'tars_knowledge_search',
      'tars_sql_schema',
      'tars_sql_query',
      'tars_create_chart',
      'tars_generate_file',
    ]);
  });
});

describe('withTarsSpreadsheetTools', () => {
  it('adds only the spreadsheet tools, keeping what is there', () => {
    expect(withTarsSpreadsheetTools(['web_search'])).toEqual([
      'web_search',
      'tars_data_schema',
      'tars_data_query',
    ]);
  });

  it('adds the row-by-row task only next to knowledge search, without duplicates', () => {
    expect(withTarsSpreadsheetTools(['tars_knowledge_search', 'tars_generate_file'])).toEqual([
      'tars_knowledge_search',
      'tars_generate_file',
      'tars_data_schema',
      'tars_data_query',
      'tars_table_task',
    ]);
  });
});

describe('tarsBuiltinToolCapability', () => {
  it('ties each switched tool to its capability and leaves the rest to TARS alone', () => {
    expect(tarsBuiltinToolCapability('tars_knowledge_search')).toBe(AgentCapabilities.rag_agent);
    expect(tarsBuiltinToolCapability('tars_table_task')).toBe(AgentCapabilities.rag_agent);
    expect(tarsBuiltinToolCapability('tars_sql_query')).toBe(AgentCapabilities.sql_agent);
    expect(tarsBuiltinToolCapability('tars_create_chart')).toBe(AgentCapabilities.chart_agent);
    expect(tarsBuiltinToolCapability('tars_data_query')).toBeUndefined();
    expect(tarsBuiltinToolCapability('tars_generate_file')).toBe(AgentCapabilities.file_agent);
    expect(tarsBuiltinToolCapability('web_search')).toBeUndefined();
  });
});
