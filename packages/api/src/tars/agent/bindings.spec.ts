import { AgentCapabilities } from 'librechat-data-provider';
import { hasTarsAgentBindings, resolveTarsAgentBindings } from './bindings';

const doc = { id: 'doc-1', filename: 'orders.xlsx' };

describe('resolveTarsAgentBindings', () => {
  it('follows the chat switches when every capability is enabled', () => {
    const bindings = resolveTarsAgentBindings({
      toggles: { sql_agent: true, rag_agent: true, chart_agent: false },
      documents: [doc as never],
    });
    expect(bindings).toEqual({
      knowledgeBases: true,
      database: true,
      chart: false,
      documents: [doc],
    });
    expect(hasTarsAgentBindings(bindings)).toBe(true);
  });

  it('drops a switch whose capability librechat.yaml disabled', () => {
    const bindings = resolveTarsAgentBindings({
      toggles: { sql_agent: true, rag_agent: true, chart_agent: true },
      capabilities: [AgentCapabilities.rag_agent],
    });
    expect(bindings).toEqual({
      knowledgeBases: true,
      database: false,
      chart: false,
      documents: [],
    });
  });

  it('binds nothing without switches or spreadsheets', () => {
    const bindings = resolveTarsAgentBindings({ toggles: null, documents: null });
    expect(hasTarsAgentBindings(bindings)).toBe(false);
  });

  it('counts spreadsheets alone as a binding', () => {
    expect(hasTarsAgentBindings(resolveTarsAgentBindings({ documents: [doc as never] }))).toBe(
      true,
    );
  });
});
