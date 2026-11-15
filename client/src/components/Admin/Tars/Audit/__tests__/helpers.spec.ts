import type { TTarsAuditMessage } from 'librechat-data-provider';
import {
  cellText,
  agentLabel,
  distinctLabels,
  groupConversations,
  CONVERSATION_COLUMNS,
  conversationCellText,
  conversationAgentLabel,
} from '../helpers';
import { toCsvBlob } from '../../Users/helpers';

const localize = (key: string, values?: Record<string, string>) =>
  values ? `${key}:${Object.values(values).join(',')}` : key;

const row = (overrides: Partial<TTarsAuditMessage>): TTarsAuditMessage => ({
  message_id: 'm-1',
  user_id: '3',
  username: 'ada',
  agent_id: null,
  agent_name: null,
  user_query: 'q',
  model_response: 'a',
  conversation_id: 'c-1',
  conversation_name: 'Invoices',
  knowledge_base_name: null,
  model_name: null,
  created_at: null,
  upload_files: null,
  memory_document: null,
  memory_website: null,
  is_web_search: false,
  is_sql_agent: false,
  ip_address: null,
  like_counts: 0,
  dislike_counts: 0,
  comments: '',
  is_deleted: false,
  conversation_is_deleted: false,
  ...overrides,
});

const column = (field: string) => CONVERSATION_COLUMNS.find((c) => c.field === field)!;

describe('agent labels', () => {
  it('names the agent, the lack of one, or a deleted one by its id', () => {
    expect(agentLabel({ agent_id: 'agent_a', agent_name: 'Bot' }, localize)).toBe('Bot');
    expect(agentLabel({ agent_id: null, agent_name: null }, localize)).toBe(
      'com_ui_tars_audit_no_agent',
    );
    expect(agentLabel({ agent_id: 'agent_x', agent_name: null }, localize)).toBe(
      'com_ui_tars_audit_agent_deleted:agent_x',
    );
  });

  /** Two agents that share a name are two agents, in a conversation row too. */
  it('lists two same-named agents of one conversation apart', () => {
    const [conversation] = groupConversations([
      row({ message_id: 'm-1', agent_id: 'agent_a', agent_name: 'Bot' }),
      row({ message_id: 'm-2', agent_id: 'agent_b', agent_name: 'Bot' }),
      row({ message_id: 'm-3', agent_id: 'agent_a', agent_name: 'Bot' }),
    ]);
    expect(conversationAgentLabel(conversation, localize)).toBe(
      ['Bot', 'Bot'].join('com_ui_tars_audit_trace_list_separator'),
    );
  });

  it('appends the id only to labels that collide', () => {
    expect(
      distinctLabels([
        { id: 'agent_a', label: 'Bot' },
        { id: 'agent_b', label: 'Bot' },
        { id: 'agent_c', label: 'Helper' },
      ]).map((item) => item.label),
    ).toEqual(['Bot (agent_a)', 'Bot (agent_b)', 'Helper']);
  });
});

describe('conversation cells', () => {
  /** The CSV says what the screen says, so an untitled conversation is named the same way. */
  it('names an untitled conversation as the screen does', () => {
    const [conversation] = groupConversations([row({ conversation_name: null })]);
    expect(conversationCellText(conversation, column('conversation_name'), localize)).toBe(
      'com_ui_tars_audit_untitled_conversation',
    );
  });

  /** Accounts are hard-deleted; the row still says whose message it was. */
  it('names a deleted account rather than leaving the user blank', () => {
    const [conversation] = groupConversations([row({ username: null })]);
    expect(conversationCellText(conversation, column('username'), localize)).toBe(
      'com_ui_tars_audit_trace_user_deleted',
    );
    const format = { date: () => '', agent: () => '', deletedUser: 'gone' };
    expect(cellText(row({ username: null }), column('username'), format)).toBe('gone');
  });

  it('marks the conversation deleted when any of its rows says so', () => {
    const [conversation] = groupConversations([
      row({ message_id: 'm-1' }),
      row({ message_id: 'm-2', conversation_is_deleted: true }),
    ]);
    expect(conversationCellText(conversation, column('is_deleted'), localize)).toBe('V');
    expect(conversationCellText(conversation, column('message_count'), localize)).toBe('2');
  });
});

describe('CSV cells', () => {
  /** jsdom's Blob has no `text()`, so it is read the way a browser without it would. */
  const readBlob = (blob: Blob) =>
    new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blob);
    });

  const csvOf = async (cells: string[]) => {
    const text = await readBlob(toCsvBlob(['h'], [cells]));
    return text
      .replace(/^\uFEFF/, '')
      .split('\r\n')
      .slice(1)
      .join('\r\n');
  };

  /** Exports carry what users typed; Excel must not run it as a formula. */
  it.each(['=HYPERLINK("x")', '+1+1', '-cmd', '@SUM(A1)'])('keeps %s as text', async (cell) => {
    expect(await csvOf([cell])).toMatch(/^"?'/);
  });

  it('leaves signed numbers as numbers', async () => {
    expect(await csvOf(['-5', '+3.5', '42'])).toBe('-5,+3.5,42');
  });

  it('quotes a bare carriage return so it cannot split the row', async () => {
    expect(await csvOf(['a\rb'])).toBe('"a\rb"');
  });
});
