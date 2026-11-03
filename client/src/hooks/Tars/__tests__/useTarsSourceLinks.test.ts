import { Tools } from 'librechat-data-provider';
import { renderHook } from '@testing-library/react';
import type { TAttachment, TMessage } from 'librechat-data-provider';
import useTarsSourceLinks, {
  linkTarsSources,
  tarsSourceLinkAgent,
  collectTarsSourceLinks,
} from '../useTarsSourceLinks';

let mockMessages: TMessage[] = [];
let mockAgent: { tars_source_download?: boolean } | undefined;
const mockAgentQuery = jest.fn();

jest.mock('~/Providers', () => ({
  useMessageContext: () => ({ messageId: 'a2', conversationId: 'convo-1' }),
}));
jest.mock('~/data-provider', () => ({
  useGetMessagesByConvoId: () => ({ data: mockMessages }),
  useGetAgentByIdQuery: (agentId: string | undefined) => {
    mockAgentQuery(agentId);
    return { data: agentId ? mockAgent : undefined };
  },
}));

const TW = 'XX公司人力資源管理辦法（臺灣）.docx';
const CN = '人力資源管理制度（中國廠區）.docx';
const link = (agent: string, doc: string) => `/api/tars/kb-files/${agent}/kb1/${doc}?sig=abc`;

const searchAttachment = (sources: Array<{ filename: string; url?: string }>): TAttachment =>
  ({
    type: Tools.tars_trace,
    [Tools.tars_trace]: {
      trace: [],
      step: {
        tool: 'knowledge_search',
        ok: true,
        sources: sources.map((s) => ({ chunks: 1, ...s })),
      },
    },
  }) as unknown as TAttachment;

const message = (
  messageId: string,
  parentMessageId: string | null,
  attachments: TAttachment[] = [],
  model = 'agent_hr',
): TMessage =>
  ({ messageId, parentMessageId, model, attachments, isCreatedByUser: false }) as TMessage;

describe('linkTarsSources', () => {
  const links = new Map([
    [TW, link('agent_hr', 'd1')],
    [CN, link('agent_hr', 'd2')],
  ]);

  it('links the names written after 資料來源, with or without their extension', () => {
    const text = `正文提到${TW}。\n\n*資料來源：《XX公司人力資源管理辦法（臺灣）》、《${CN}》*`;
    expect(linkTarsSources(text, links)).toBe(
      `正文提到${TW}。\n\n*資料來源：《[XX公司人力資源管理辦法（臺灣）](${link('agent_hr', 'd1')})》、` +
        `《[${CN}](${link('agent_hr', 'd2')})》*`,
    );
  });

  it('leaves names that differ, and answers without 資料來源, as they are', () => {
    const near = '資料來源：《XX公司人力資源管理辦法》';
    expect(linkTarsSources(near, links)).toBe(near);
    expect(linkTarsSources(`參考：${TW}`, links)).toBe(`參考：${TW}`);
    expect(linkTarsSources(`資料來源：${TW}`, new Map())).toBe(`資料來源：${TW}`);
  });

  it('keeps a stem two files share as text, but still links their full names', () => {
    const shared = new Map([
      ['規章.pdf', link('agent_hr', 'p')],
      ['規章.docx', link('agent_hr', 'w')],
    ]);
    expect(linkTarsSources('資料來源：規章、規章.pdf', shared)).toBe(
      `資料來源：規章、[規章.pdf](${link('agent_hr', 'p')})`,
    );
  });

  it('escapes brackets in the linked name', () => {
    const odd = new Map([['[草稿] 辦法.pdf', link('agent_hr', 'x')]]);
    expect(linkTarsSources('資料來源：[草稿] 辦法.pdf', odd)).toBe(
      `資料來源：[\\[草稿\\] 辦法.pdf](${link('agent_hr', 'x')})`,
    );
  });
});

describe('collectTarsSourceLinks', () => {
  it('reads the agent from a relay link', () => {
    expect(tarsSourceLinkAgent(link('agent_hr', 'd1'))).toBe('agent_hr');
    expect(tarsSourceLinkAgent('/api/tars/static/quickchart/a.png')).toBeUndefined();
  });

  it('collects the answer’s own links, then those of the answers it follows', () => {
    const messages = [
      message('a1', 'u1', [searchAttachment([{ filename: TW, url: link('agent_hr', 'old') }])]),
      message('u2', 'a1'),
      message('a2', 'u2', [
        searchAttachment([
          { filename: TW, url: link('agent_hr', 'new') },
          { filename: 'https://law.moj.gov.tw' },
        ]),
      ]),
      message('u3', 'a2'),
      message('a3', 'u3'),
      message('sibling', 'u3', [searchAttachment([{ filename: CN, url: link('agent_hr', 'd2') }])]),
    ];

    const { agentId, links } = collectTarsSourceLinks(messages, 'a3');
    expect(agentId).toBe('agent_hr');
    expect([...links]).toEqual([[TW, link('agent_hr', 'new')]]);
  });

  it('counts only links minted for the agent that wrote the answer', () => {
    const messages = [
      message('a1', null, [searchAttachment([{ filename: TW, url: link('agent_other', 'd1') }])]),
      message('a2', 'a1', [], 'agent_hr'),
    ];
    expect(collectTarsSourceLinks(messages, 'a2').links.size).toBe(0);
  });

  it('reads a streaming answer’s links from its live attachments', () => {
    const live = [searchAttachment([{ filename: CN, url: link('agent_hr', 'd2') }])];
    const { agentId, links } = collectTarsSourceLinks(undefined, 'streaming', live);
    expect(agentId).toBe('agent_hr');
    expect(links.get(CN)).toBe(link('agent_hr', 'd2'));
  });
});

describe('useTarsSourceLinks', () => {
  const answer = '*資料來源：《XX公司人力資源管理辦法（臺灣）》*';

  beforeEach(() => {
    mockMessages = [
      message('a1', null, [searchAttachment([{ filename: TW, url: link('agent_hr', 'd1') }])]),
      message('a2', 'a1'),
    ];
    mockAgentQuery.mockClear();
  });

  it('links a follow-up answer while the agent still offers its sources', () => {
    mockAgent = { tars_source_download: true };
    const { result } = renderHook(() => useTarsSourceLinks(answer));
    expect(result.current).toBe(
      `*資料來源：《[XX公司人力資源管理辦法（臺灣）](${link('agent_hr', 'd1')})》*`,
    );
    expect(mockAgentQuery).toHaveBeenCalledWith('agent_hr');
  });

  it('shows plain text once the switch is off, and asks for no agent without links', () => {
    mockAgent = { tars_source_download: false };
    expect(renderHook(() => useTarsSourceLinks(answer)).result.current).toBe(answer);

    mockMessages = [message('a1', null), message('a2', 'a1')];
    mockAgentQuery.mockClear();
    expect(renderHook(() => useTarsSourceLinks(answer)).result.current).toBe(answer);
    expect(mockAgentQuery).toHaveBeenLastCalledWith(undefined);
  });
});
