jest.mock('@librechat/data-schemas', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

import { ContentTypes } from 'librechat-data-provider';
import type { TMessageContentParts } from 'librechat-data-provider';
import { rewriteTarsAssetLinks, signedTarsAssets } from '~/tars/assets';
import { repairTarsGeneratedLinks } from './repair';

const PPTX = '遠距工作的優缺點_c32a9b.pptx';
const PPTX_PATH = `/static/generate_output/default/${PPTX}`;
const CHART_PATH = '/static/quickchart/default/chart_1793631940_a8909c.png';

/** The relay link a TARS tool result carries for `path`, minted the way `toModelText` does. */
const relayed = (path: string): string => rewriteTarsAssetLinks(`http://202.5.253.240:85${path}`);

const toolCall = (output: string): TMessageContentParts =>
  ({
    type: ContentTypes.TOOL_CALL,
    tool_call: { id: 'call_1', name: 'tars_generate_file', args: '{}', output },
  }) as TMessageContentParts;

const text = (value: string): TMessageContentParts => ({ type: ContentTypes.TEXT, text: value });

const generated = (path: string): TMessageContentParts =>
  toolCall(`File created. Include this markdown link exactly:\n\n[簡報](${relayed(path)})`);

const textOf = (parts: TMessageContentParts[]): string =>
  parts
    .flatMap((part) => {
      if (part.type !== ContentTypes.TEXT) {
        return [];
      }
      return [typeof part.text === 'string' ? part.text : (part.text?.value ?? '')];
    })
    .join('\n');

beforeEach(() => {
  process.env.JWT_SECRET = 'relay-test-secret';
});

describe('signedTarsAssets', () => {
  it('reads one file from either spelling of its path', () => {
    const encoded = rewriteTarsAssetLinks(
      `http://h/static/generate_output/default/${encodeURIComponent(PPTX)}`,
    );
    const [fromRaw] = signedTarsAssets(relayed(PPTX_PATH));
    const [fromEncoded] = signedTarsAssets(encoded);

    expect(fromRaw).toEqual(fromEncoded);
    expect(fromRaw.name).toBe(PPTX);
  });

  it('ignores a link whose signature LibreChat did not mint', () => {
    const forged = relayed(PPTX_PATH).replace(/sig=.{4}/, 'sig=AAAA');
    expect(signedTarsAssets(forged)).toEqual([]);
    expect(signedTarsAssets(`/api/tars/static/generate_output/default/${PPTX}`)).toEqual([]);
  });
});

describe('repairTarsGeneratedLinks', () => {
  let link: string;
  beforeEach(() => {
    [{ link }] = signedTarsAssets(relayed(PPTX_PATH));
  });

  it.each([
    [
      'a sandbox: prefix',
      `sandbox:/api/tars/static/generate_output/default/${PPTX}?sig=${'x'.repeat(22)}`,
    ],
    ['a dropped signature', `/api/tars/static/generate_output/default/${PPTX}`],
    ['an invented host', `https://example.com/api/tars/static/generate_output/default/${PPTX}`],
    ['a code-interpreter path', `sandbox:/mnt/data/${PPTX}`],
    ['pwc_tars own host', `http://202.5.253.240:85${PPTX_PATH}`],
    ['an encoded file name', `https://chat.openai.com/files/${encodeURIComponent(PPTX)}`],
  ])('points %s back at the relay link the tool returned', (_case, written) => {
    const parts = [generated(PPTX_PATH), text(`簡報已完成：[下載簡報](${written})。`)];

    const repaired = repairTarsGeneratedLinks(parts, []);

    expect(textOf(repaired)).toBe(`簡報已完成：[下載簡報](${link})。`);
    expect(parts[1]).toEqual(text(`簡報已完成：[下載簡報](${written})。`));
  });

  it('returns the same parts when every link is already right', () => {
    const parts = [generated(PPTX_PATH), text(`[下載簡報](${relayed(PPTX_PATH)})`)];
    expect(repairTarsGeneratedLinks(parts, [])).toBe(parts);
  });

  it('repairs a chart image and keeps the rest of the text', () => {
    const [{ link: chart }] = signedTarsAssets(relayed(CHART_PATH));
    const parts = [
      toolCall(`Chart created.\n\n![chart](${relayed(CHART_PATH)})`),
      text(`看圖：\n\n![趨勢圖](sandbox:${CHART_PATH})\n\n[官網](https://pwc.com/report.pdf)`),
    ];

    expect(textOf(repairTarsGeneratedLinks(parts, []))).toBe(
      `看圖：\n\n![趨勢圖](${chart})\n\n[官網](https://pwc.com/report.pdf)`,
    );
  });

  it('repairs a link to a file generated earlier in the thread', () => {
    const agent = {
      dynamicToolContextMap: {
        tars_generated_files: `# Generated files Runtime Context\n- file: [${PPTX}](${relayed(PPTX_PATH)})`,
      },
    };
    const parts = [text(`上次的簡報在這：[簡報](sandbox:/mnt/data/${PPTX})`)];

    expect(textOf(repairTarsGeneratedLinks(parts, [null, agent]))).toBe(
      `上次的簡報在這：[簡報](${link})`,
    );
  });

  it('repairs text stored as a value object', () => {
    const parts: TMessageContentParts[] = [
      generated(PPTX_PATH),
      {
        type: ContentTypes.TEXT,
        text: { value: `[簡報](sandbox:/mnt/data/${PPTX})`, annotations: [] },
      },
    ];

    const [, part] = repairTarsGeneratedLinks(parts, []);

    expect(part).toEqual({
      type: ContentTypes.TEXT,
      text: { value: `[簡報](${link})`, annotations: [] },
    });
  });

  it('never links a file no tool result named', () => {
    const invented = `[報告](sandbox:/api/tars/static/generate_output/default/其他使用者的檔案_123456.pdf)`;
    const parts = [generated(PPTX_PATH), text(invented)];
    expect(repairTarsGeneratedLinks(parts, [])).toBe(parts);
  });

  it('trusts no link the model wrote itself, even with a signature', () => {
    const forged = relayed(PPTX_PATH).replace(/sig=.{4}/, 'sig=AAAA');
    const parts = [toolCall(`[簡報](${forged})`), text(`[簡報](sandbox:/mnt/data/${PPTX})`)];
    expect(repairTarsGeneratedLinks(parts, [])).toBe(parts);
  });

  it('leaves a file name two generated files share', () => {
    const other = '/static/generate_output/kb_2/' + PPTX;
    const parts = [
      generated(PPTX_PATH),
      generated(other),
      text(`[簡報](sandbox:/mnt/data/${PPTX})`),
    ];
    expect(repairTarsGeneratedLinks(parts, [])).toBe(parts);
  });

  it('changes nothing without a secret to verify signatures with', () => {
    const parts = [generated(PPTX_PATH), text(`[簡報](sandbox:/mnt/data/${PPTX})`)];
    delete process.env.JWT_SECRET;
    expect(repairTarsGeneratedLinks(parts, [])).toBe(parts);
  });
});
