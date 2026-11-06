/** The repair itself is exercised in packages/api (`tars/files/repair.spec.ts`);
 *  this pins the wiring: `sendCompletion` hands the saved, mirrored and final
 *  reply the repaired content, with the thread's earlier links as a source. */
const { ContentTypes } = require('librechat-data-provider');
const { rewriteTarsAssetLinks } = require('@librechat/api');
const AgentClient = require('../client');

const FILE = 'report_c32a9b.pptx';
const PATH = `/static/generate_output/default/${FILE}`;

function selfWith(contentParts, agent = {}) {
  return {
    contentParts,
    options: { agent },
    agentConfigs: new Map(),
    abortController: null,
    chatCompletion: jest.fn(async () => {}),
    isCompactionTurn: () => false,
    buildResponseMetadata: () => undefined,
  };
}

describe('AgentClient.sendCompletion — TARS generated links', () => {
  const secret = process.env.JWT_SECRET;
  beforeAll(() => {
    process.env.JWT_SECRET = 'link-repair-secret';
  });
  afterAll(() => {
    process.env.JWT_SECRET = secret;
  });

  it('replaces a link the model rewrote with the one the tool returned', async () => {
    const relayed = rewriteTarsAssetLinks(`http://tars.test${PATH}`);
    const self = selfWith([
      {
        type: ContentTypes.TOOL_CALL,
        tool_call: { id: 'c1', name: 'tars_generate_file', args: '{}', output: `[r](${relayed})` },
      },
      { type: ContentTypes.TEXT, text: `[下載](sandbox:/mnt/data/${FILE})` },
    ]);

    const { completion } = await AgentClient.prototype.sendCompletion.call(self, []);

    expect(completion[1].text).toBe(`[下載](${relayed})`);
  });

  it('reads files generated earlier in the thread from the agent context', async () => {
    const relayed = rewriteTarsAssetLinks(`http://tars.test${PATH}`);
    const agent = {
      dynamicToolContextMap: { tars_generated_files: `- file: [${FILE}](${relayed})` },
    };
    const self = selfWith([{ type: ContentTypes.TEXT, text: `[下載](${PATH})` }], agent);

    const { completion } = await AgentClient.prototype.sendCompletion.call(self, []);

    expect(completion[0].text).toBe(`[下載](${relayed})`);
  });
});
