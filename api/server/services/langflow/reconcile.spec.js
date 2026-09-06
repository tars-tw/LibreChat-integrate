/**
 * Integration test for the Langflow → shared-agent reconcile.
 *
 * Langflow keeps a flow's `action_name` fixed when the flow is renamed, so the agent id is stable
 * while the display name is not. The reconcile therefore has to converge on the id: rename in
 * place, drop the rows a create-only pass left behind, and remove agents whose flow is gone.
 * Only the outbound Langflow call and the ACL grant are stubbed; the agent writes are real.
 */

jest.mock('~/server/services/PermissionService', () => ({
  grantPermission: jest.fn(async () => undefined),
}));

/** The model catalogue this instance serves; only the endpoint→models shape matters here. */
jest.mock('~/server/controllers/ModelController', () => ({
  getModelsConfig: jest.fn(async () => ({
    openAI: ['gpt-5.4-mini', 'gpt-5.5'],
    google: ['gemini-3.6-flash'],
  })),
}));

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { createModels } = require('@librechat/data-schemas');

createModels(mongoose);
const db = require('~/models');
const { reconcileLangflowAgents } = require('./reconcile');

const OWNER_EMAIL = 'langflow-owner@example.com';

/** Shape of one entry in Langflow's `GET /api/v1/mcp/project/:id` response. */
const flow = (name, actionName, model) => ({
  id: `flow-${actionName}`,
  name,
  action_name: actionName,
  description: `${name} description`,
  mcp_enabled: true,
  /** Not part of the MCP listing — the test's stand-in for what the flow's TarsTool node holds,
   *  which the reconcile reads from `GET /api/v1/flows/:id`. */
  model,
});

const flowDefinition = (model) => ({
  data: {
    nodes: [
      { data: { type: 'ChatInput', node: { template: {} } } },
      {
        data: { type: 'TarsTool', node: { template: { ctx__model_name: { value: model ?? '' } } } },
      },
    ],
  },
});

describe('reconcileLangflowAgents', () => {
  let mongoServer;
  let ownerId;

  /** The module debounces consecutive runs by 8s of wall clock; the tests need many runs back to
   *  back, so the clock is advanced between them rather than the debounce being reached into. */
  let clock;

  /** Serves both Langflow calls the reconcile makes: the MCP listing, and the per-flow definition
   *  it reads the TARS node's model from. */
  const respondWith = (flows) => {
    global.fetch = jest.fn(async (url) => {
      const match = String(url).match(/\/api\/v1\/flows\/(.+)$/);
      if (match) {
        const source = flows.find((entry) => entry.id === match[1]);
        return { ok: true, json: async () => flowDefinition(source?.model) };
      }
      return { ok: true, json: async () => ({ tools: flows }) };
    });
  };

  const reconcile = async (flows) => {
    respondWith(flows);
    clock += 60_000;
    await reconcileLangflowAgents({ user: { id: 'req-user' } });
  };

  const agentNames = async () =>
    (await db.getAgents({ author: ownerId })).map((agent) => `${agent.id}|${agent.name}`).sort();

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
    process.env.LANGFLOW_API_KEY = 'test-key';
    process.env.VITE_LANGFLOW_URL = 'http://langflow.test';
    process.env.LANGFLOW_PROJECT_ID = 'project-1';
    process.env.LANGFLOW_AGENT_OWNER_EMAIL = OWNER_EMAIL;
    const owner = await mongoose.models.User.create({
      email: OWNER_EMAIL,
      name: 'Owner',
      provider: 'local',
    });
    ownerId = owner._id;
    clock = Date.now();
    jest.spyOn(Date, 'now').mockImplementation(() => clock);
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await mongoose.models.Agent.deleteMany({});
  });

  it('creates one shared agent per MCP-enabled flow', async () => {
    await reconcile([flow('TARS_RAG', 'tars_rag'), flow('Simple Agent', 'simple_agent')]);
    expect(await agentNames()).toEqual([
      'agent_langflow_simple_agent|Langflow · Simple Agent',
      'agent_langflow_tars_rag|Langflow · TARS_RAG',
    ]);
  });

  it('renames the existing agent instead of adding a second one when a flow is renamed', async () => {
    await reconcile([flow('TARS_RAG', 'tars_rag')]);
    const [before] = await db.getAgents({ id: 'agent_langflow_tars_rag' });

    await reconcile([flow('TARS_tool', 'tars_rag')]);

    const after = await db.getAgents({ id: 'agent_langflow_tars_rag' });
    expect(after).toHaveLength(1);
    expect(after[0].name).toBe('Langflow · TARS_tool');
    expect(after[0]._id.toString()).toBe(before._id.toString());
    expect(after[0].instructions).toContain('"TARS_tool" flow');
  });

  it('keeps the tool binding pointed at the flow action name', async () => {
    await reconcile([flow('TARS_tool', 'tars_rag')]);
    const [agent] = await db.getAgents({ id: 'agent_langflow_tars_rag' });
    expect(agent.tools).toEqual(['tars_rag_mcp_langflow']);
  });

  it('removes duplicate rows a create-only pass left behind', async () => {
    await mongoose.models.Agent.insertMany([
      {
        id: 'agent_langflow_tars_rag',
        name: 'Langflow · TARS_RAG',
        provider: 'openAI',
        model: 'gpt-5.4-mini',
        author: ownerId,
      },
      {
        id: 'agent_langflow_tars_rag',
        name: 'Langflow · TARS_tool',
        provider: 'openAI',
        model: 'gpt-5.4-mini',
        author: ownerId,
      },
    ]);

    await reconcile([flow('TARS_tool', 'tars_rag')]);

    const rows = await db.getAgents({ id: 'agent_langflow_tars_rag' });
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Langflow · TARS_tool');
  });

  it('removes agents whose flow is gone or no longer MCP-enabled', async () => {
    await reconcile([flow('TARS_tool', 'tars_rag'), flow('Simple Agent (1)', 'simple_agent_1')]);
    await reconcile([flow('TARS_tool', 'tars_rag')]);
    expect(await agentNames()).toEqual(['agent_langflow_tars_rag|Langflow · TARS_tool']);
  });

  it('leaves everything alone when Langflow is unreachable', async () => {
    await reconcile([flow('TARS_tool', 'tars_rag')]);

    global.fetch = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    clock += 60_000;
    await reconcileLangflowAgents({ user: { id: 'req-user' } });

    expect(await agentNames()).toEqual(['agent_langflow_tars_rag|Langflow · TARS_tool']);
  });

  it("orchestrates on the model the flow's TARS node names", async () => {
    await reconcile([flow('TARS_tool', 'tars_rag', 'gemini-3.6-flash')]);
    const [agent] = await db.getAgents({ id: 'agent_langflow_tars_rag' });
    expect(agent.provider).toBe('google');
    expect(agent.model).toBe('gemini-3.6-flash');
  });

  it('follows the node when its model changes', async () => {
    await reconcile([flow('TARS_tool', 'tars_rag', 'gemini-3.6-flash')]);
    await reconcile([flow('TARS_tool', 'tars_rag', 'gpt-5.5')]);
    const [agent] = await db.getAgents({ id: 'agent_langflow_tars_rag' });
    expect(agent.provider).toBe('openAI');
    expect(agent.model).toBe('gpt-5.5');
  });

  it('falls back to the configured default when the node names no model', async () => {
    await reconcile([flow('TARS_tool', 'tars_rag')]);
    const [agent] = await db.getAgents({ id: 'agent_langflow_tars_rag' });
    expect(agent.provider).toBe('openAI');
    expect(agent.model).toBe('gpt-5.4-mini');
  });

  it('leaves a hand-tuned model alone while the node names none', async () => {
    await reconcile([flow('TARS_tool', 'tars_rag')]);
    await db.updateAgent(
      { id: 'agent_langflow_tars_rag' },
      { provider: 'google', model: 'gemini-3.6-flash' },
      { skipVersioning: true },
    );

    await reconcile([flow('TARS_tool', 'tars_rag')]);

    const [agent] = await db.getAgents({ id: 'agent_langflow_tars_rag' });
    expect(agent.model).toBe('gemini-3.6-flash');
  });

  it('keeps the existing model when the node names one no endpoint serves', async () => {
    await reconcile([flow('TARS_tool', 'tars_rag', 'some-unconfigured-model')]);
    const [agent] = await db.getAgents({ id: 'agent_langflow_tars_rag' });
    expect(agent.model).toBe('gpt-5.4-mini');
  });

  it('is a no-op on a second identical pass', async () => {
    await reconcile([flow('TARS_tool', 'tars_rag', 'gemini-3.6-flash')]);
    const [first] = await db.getAgents({ id: 'agent_langflow_tars_rag' });
    await reconcile([flow('TARS_tool', 'tars_rag', 'gemini-3.6-flash')]);
    const [second] = await db.getAgents({ id: 'agent_langflow_tars_rag' });
    expect(second.updatedAt.getTime()).toBe(first.updatedAt.getTime());
  });
});
