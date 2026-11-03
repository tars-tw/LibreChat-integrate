import { hasTarsKnowledgeSearch, isTarsSourceDownloadEnabled } from '../src/tars';

describe('參考資料下載', () => {
  it('recognizes the knowledge search among the agent tools', () => {
    expect(hasTarsKnowledgeSearch(['web_search', 'tars_knowledge_search'])).toBe(true);
    expect(hasTarsKnowledgeSearch(['tars_sql_query', 'rag_agent'])).toBe(false);
    expect(hasTarsKnowledgeSearch(undefined)).toBe(false);
  });

  it('is on only when switched on with the knowledge search equipped', () => {
    const tools = ['tars_knowledge_search'];
    expect(isTarsSourceDownloadEnabled({ tools, tars_source_download: true })).toBe(true);
    expect(isTarsSourceDownloadEnabled({ tools, tars_source_download: false })).toBe(false);
    expect(isTarsSourceDownloadEnabled({ tools })).toBe(false);
    expect(isTarsSourceDownloadEnabled({ tools: [], tars_source_download: true })).toBe(false);
    expect(isTarsSourceDownloadEnabled(null)).toBe(false);
  });
});
