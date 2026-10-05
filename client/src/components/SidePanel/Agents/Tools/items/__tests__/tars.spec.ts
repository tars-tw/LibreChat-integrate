import { isTarsSwitchId, isTarsSwitchSelected, toggleTarsSwitchTools } from '../tars';

describe('pwc_tars switches on agent.tools', () => {
  test('recognizes only the four switch ids', () => {
    expect(isTarsSwitchId('rag_agent')).toBe(true);
    expect(isTarsSwitchId('sql_agent')).toBe(true);
    expect(isTarsSwitchId('chart_agent')).toBe(true);
    expect(isTarsSwitchId('file_agent')).toBe(true);
    expect(isTarsSwitchId('tars_agent')).toBe(false);
    expect(isTarsSwitchId('web_search')).toBe(false);
  });

  test('turning a switch on adds only its own tools', () => {
    expect(toggleTarsSwitchTools(['web_search'], 'rag_agent', true)).toEqual([
      'web_search',
      'tars_knowledge_search',
    ]);
    expect(toggleTarsSwitchTools([], 'file_agent', true)).toEqual(['tars_generate_file']);
  });

  test('switches are independent of each other', () => {
    const both = toggleTarsSwitchTools(
      toggleTarsSwitchTools([], 'sql_agent', true),
      'file_agent',
      true,
    );
    expect(toggleTarsSwitchTools(both, 'sql_agent', false)).toEqual(['tars_generate_file']);
    expect(toggleTarsSwitchTools(both, 'file_agent', false)).toEqual([
      'tars_sql_schema',
      'tars_sql_query',
    ]);
  });

  test('a partial set counts as selected and is fully removed', () => {
    const tools = ['tars_sql_query', 'tars_generate_file'];
    expect(isTarsSwitchSelected(tools, 'sql_agent')).toBe(true);
    expect(isTarsSwitchSelected(tools, 'file_agent')).toBe(true);
    expect(isTarsSwitchSelected(tools, 'rag_agent')).toBe(false);
    expect(toggleTarsSwitchTools(tools, 'sql_agent', false)).toEqual(['tars_generate_file']);
  });
});
