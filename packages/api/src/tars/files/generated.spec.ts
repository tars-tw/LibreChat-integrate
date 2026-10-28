import { Constants, Tools } from 'librechat-data-provider';
import type { TarsGeneratedLinkMessage } from './generated';
import {
  collectTarsGeneratedLinks,
  TARS_GENERATED_LINKS_LIMIT,
  addTarsGeneratedFilesContext,
  buildTarsGeneratedFilesContext,
} from './generated';
import { getThreadData } from '~/utils/message';

const NO_PARENT = String(Constants.NO_PARENT);
const FILE = '/api/tars/static/generate_output/kb';
const CHART = '/api/tars/static/quickchart/kb';

const stepTrace = (links: Array<{ type: string; url: string }>) => ({
  type: Tools.tars_trace,
  [Tools.tars_trace]: { step: { links } },
});

const runTrace = (links: Array<{ type: string; url: string }>) => ({
  type: Tools.tars_trace,
  [Tools.tars_trace]: { links },
});

const message = (
  messageId: string,
  parentMessageId: string,
  attachments: TarsGeneratedLinkMessage['attachments'] = [],
): TarsGeneratedLinkMessage => ({ messageId, parentMessageId, attachments });

/** Collects along the parent chain the way `resolveTarsTurnFiles` walks it. */
const collect = (
  messages: TarsGeneratedLinkMessage[],
  parentMessageId: string | undefined,
  limit?: number,
) =>
  collectTarsGeneratedLinks(messages, getThreadData(messages, parentMessageId).messageIds, limit);

describe('collectTarsGeneratedLinks', () => {
  it('lists both built-in tool steps and nested runs up the parent chain, oldest first', () => {
    const messages = [
      message('u1', NO_PARENT),
      message('a1', 'u1', [stepTrace([{ type: 'file', url: `${FILE}/report_1.xlsx?sig=x` }])]),
      message('u2', 'a1'),
      message('a2', 'u2', [runTrace([{ type: 'chart', url: `${CHART}/chart_2.png?sig=y` }])]),
    ];

    expect(collect(messages, 'a2')).toEqual([
      { type: 'file', url: `${FILE}/report_1.xlsx?sig=x`, name: 'report_1.xlsx' },
      { type: 'chart', url: `${CHART}/chart_2.png?sig=y`, name: 'chart_2.png' },
    ]);
  });

  it("never lists a sibling branch's files", () => {
    const messages = [
      message('u1', NO_PARENT),
      message('a1', 'u1', [stepTrace([{ type: 'file', url: `${FILE}/kept.xlsx` }])]),
      message('a1-alt', 'u1', [stepTrace([{ type: 'file', url: `${FILE}/discarded.xlsx` }])]),
    ];

    expect(collect(messages, 'a1').map((link) => link.name)).toEqual(['kept.xlsx']);
  });

  it('lists a repeated link once, at its newest place', () => {
    const repeated = `${FILE}/report.xlsx`;
    const messages = [
      message('a1', NO_PARENT, [stepTrace([{ type: 'file', url: repeated }])]),
      message('a2', 'a1', [stepTrace([{ type: 'file', url: `${FILE}/other.xlsx` }])]),
      message('a3', 'a2', [runTrace([{ type: 'file', url: repeated }])]),
    ];

    expect(collect(messages, 'a3').map((link) => link.name)).toEqual(['other.xlsx', 'report.xlsx']);
  });

  it('keeps only the newest links past the limit', () => {
    const messages = [
      message('a1', NO_PARENT, [
        stepTrace([
          { type: 'file', url: `${FILE}/1.xlsx` },
          { type: 'file', url: `${FILE}/2.xlsx` },
        ]),
      ]),
      message('a2', 'a1', [stepTrace([{ type: 'file', url: `${FILE}/3.xlsx` }])]),
    ];

    expect(collect(messages, 'a2', 2).map((link) => link.name)).toEqual(['2.xlsx', '3.xlsx']);
  });

  it('skips other attachments and malformed links, and decodes file names', () => {
    const messages = [
      message('a1', NO_PARENT, [
        { type: Tools.web_search, file_id: 'search' },
        { type: Tools.tars_trace, [Tools.tars_trace]: { step: { links: [null, { url: ' ' }] } } },
        { type: Tools.tars_trace, [Tools.tars_trace]: null },
        stepTrace([{ type: '', url: `${FILE}/%E5%A0%B1%E5%91%8A.xlsx` }]),
      ]),
    ];

    expect(collect(messages, 'a1')).toEqual([
      { type: 'file', url: `${FILE}/%E5%A0%B1%E5%91%8A.xlsx`, name: '報告.xlsx' },
    ]);
  });

  it('names a link by its URL when the path holds no decodable file name', () => {
    const truncated = `${FILE}/%E5%A0.xlsx`;
    const bare = `${FILE}/`;
    const messages = [
      message('a1', NO_PARENT, [
        stepTrace([
          { type: 'file', url: truncated },
          { type: 'file', url: bare },
        ]),
      ]),
    ];

    expect(collect(messages, 'a1').map((link) => link.name)).toEqual([truncated, bare]);
  });

  it('is empty for a new conversation', () => {
    expect(collect([], NO_PARENT)).toEqual([]);
    expect(collect([message('a1', NO_PARENT)], undefined)).toEqual([]);
  });

  it('reads any stored shape that is not a list as no links, never throwing', () => {
    const malformed = {
      messageId: 'a1',
      parentMessageId: NO_PARENT,
      attachments: [
        null,
        { type: Tools.tars_trace, [Tools.tars_trace]: { links: 'x', step: { links: 5 } } },
        {
          type: Tools.tars_trace,
          [Tools.tars_trace]: { links: [{ type: 7, url: `${FILE}/a.xlsx` }] },
        },
      ],
    } as unknown as TarsGeneratedLinkMessage;
    const notAList = { ...message('a2', 'a1'), attachments: {} } as TarsGeneratedLinkMessage;

    expect(collectTarsGeneratedLinks([malformed, notAList], ['a2', 'a1'])).toEqual([
      { type: 'file', url: `${FILE}/a.xlsx`, name: 'a.xlsx' },
    ]);
  });

  it('lists nothing with a limit of 0, and keeps 20 by default', () => {
    const links = Array.from({ length: 25 }, (_, i) => ({
      type: 'file',
      url: `${FILE}/${i}.xlsx`,
    }));
    const messages = [message('a1', NO_PARENT, [stepTrace(links)])];

    expect(collect(messages, 'a1', 0)).toEqual([]);
    expect(TARS_GENERATED_LINKS_LIMIT).toBe(20);
    expect(collect(messages, 'a1').map((link) => link.name)).toEqual(
      links.slice(5).map((_, i) => `${i + 5}.xlsx`),
    );
  });
});

describe('buildTarsGeneratedFilesContext', () => {
  it('is absent without links', () => {
    expect(buildTarsGeneratedFilesContext([])).toBeNull();
  });

  it('gives every link verbatim, charts as images and files as links', () => {
    const context = buildTarsGeneratedFilesContext([
      { type: 'file', url: `${FILE}/report.xlsx?sig=x`, name: 'report.xlsx' },
      { type: 'chart', url: `${CHART}/chart.png?sig=y`, name: 'chart.png' },
    ]);

    expect(context).toContain('# Generated files Runtime Context');
    expect(context).toContain(`- file: [report.xlsx](${FILE}/report.xlsx?sig=x)`);
    expect(context).toContain(`- chart: ![chart.png](${CHART}/chart.png?sig=y)`);
  });

  it('leaves the agent alone when the thread generated nothing', () => {
    const agent: { dynamicToolContextMap?: Record<string, unknown> } = {};
    addTarsGeneratedFilesContext(agent, buildTarsGeneratedFilesContext([]));
    expect(agent).toEqual({});
  });

  it('frames the running turn apart from the thread', () => {
    const link = { type: 'file', url: `${FILE}/a.xlsx`, name: 'a.xlsx' };
    const turn = buildTarsGeneratedFilesContext([link], 'turn');

    expect(turn).toContain('# Generated this turn Runtime Context');
    expect(turn).not.toContain('# Generated files Runtime Context');
    expect(turn).toContain(`- file: [a.xlsx](${FILE}/a.xlsx)`);
  });
});
