/**
 * Integration test for the Langflow → Workflow agent reconcile.
 *
 * Langflow keeps a flow's `action_name` fixed when the flow is renamed, so the agent id is stable
 * while the display name is not. The reconcile therefore has to converge on the id: rename in
 * place, drop the rows a create-only pass left behind, and remove agents whose flow is gone.
 * Shared flows (the system account's) become agents everyone can use; a user's own flows become
 * agents only they can use. Only the outbound Langflow call and the ACL grant are stubbed; the
 * agent writes are real.
 */

jest.mock('~/server/services/PermissionService', () => ({
  grantPermission: jest.fn(async () => undefined),
}));

const { grantPermission } = require('~/server/services/PermissionService');

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

/** One row of Langflow's `GET /api/v1/tars/flows`: a shared (system account) flow. */
const flow = (name, actionName, model) => ({
  tool_name: actionName,
  flow_id: `flow-${actionName}`,
  name,
  description: `${name} description`,
  owner: 'system',
  tars_model: model ?? null,
  action_name: actionName,
});

/** A flow of the chatting user's own; Langflow names its tool with a `my_` prefix. */
const personalFlow = (name, toolName) => ({
  ...flow(name, toolName),
  tool_name: `my_${toolName}`,
  flow_id: `flow-my-${toolName}`,
  owner: 'personal',
});

describe('reconcileLangflowAgents', () => {
  let mongoServer;
  let ownerId;

  /** The module debounces consecutive runs by 8s of wall clock; the tests need many runs back to
   *  back, so the clock is advanced between them rather than the debounce being reached into. */
  let clock;

  /** Langflow answers the flows list; the chatting user it was asked about decides the personal rows. */
  const respondWith = (flows, personalByTarsId = {}) => {
    global.fetch = jest.fn(async (url, init) => {
      expect(String(url)).toBe('http://langflow.test/api/v1/tars/flows');
      expect(init.headers['x-api-key']).toBe('test-key');
      const tarsId = init.headers['x-langflow-global-var-tars_user_id'];
      return { ok: true, json: async () => [...flows, ...(personalByTarsId[tarsId] ?? [])] };
    });
  };

  const reconcile = async (flows, user = { id: 'req-user' }, personal = {}) => {
    respondWith(flows, personal);
    clock += 60_000;
    await reconcileLangflowAgents({ user });
  };

  const agentNames = async () =>
    (await db.getAgents({ author: ownerId })).map((agent) => `${agent.id}|${agent.name}`).sort();

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
    process.env.LANGFLOW_API_KEY = 'test-key';
    process.env.VITE_LANGFLOW_URL = 'http://langflow.test';
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
    grantPermission.mockClear();
  });

  it('creates one shared agent per MCP-enabled flow', async () => {
    await reconcile([flow('TARS_RAG', 'tars_rag'), flow('Simple Agent', 'simple_agent')]);
    expect(await agentNames()).toEqual([
      'agent_langflow_simple_agent|Workflow · Simple Agent',
      'agent_langflow_tars_rag|Workflow · TARS_RAG',
    ]);
  });

  it('renames the existing agent instead of adding a second one when a flow is renamed', async () => {
    await reconcile([flow('TARS_RAG', 'tars_rag')]);
    const [before] = await db.getAgents({ id: 'agent_langflow_tars_rag' });

    await reconcile([flow('TARS_tool', 'tars_rag')]);

    const after = await db.getAgents({ id: 'agent_langflow_tars_rag' });
    expect(after).toHaveLength(1);
    expect(after[0].name).toBe('Workflow · TARS_tool');
    expect(after[0]._id.toString()).toBe(before._id.toString());
    expect(after[0].instructions).toContain('"TARS_tool" workflow');
  });

  it('keeps the tool binding pointed at the flow action name', async () => {
    await reconcile([flow('TARS_tool', 'tars_rag')]);
    const [agent] = await db.getAgents({ id: 'agent_langflow_tars_rag' });
    expect(agent.tools).toEqual(['tars_rag_mcp_workflow']);
  });

  it('removes duplicate rows a create-only pass left behind', async () => {
    await mongoose.models.Agent.insertMany([
      {
        id: 'agent_langflow_tars_rag',
        name: 'Workflow · TARS_RAG',
        provider: 'openAI',
        model: 'gpt-5.4-mini',
        author: ownerId,
      },
      {
        id: 'agent_langflow_tars_rag',
        name: 'Workflow · TARS_tool',
        provider: 'openAI',
        model: 'gpt-5.4-mini',
        author: ownerId,
      },
    ]);

    await reconcile([flow('TARS_tool', 'tars_rag')]);

    const rows = await db.getAgents({ id: 'agent_langflow_tars_rag' });
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Workflow · TARS_tool');
  });

  it('rebrands agents published under the old Langflow name in place', async () => {
    await mongoose.models.Agent.create({
      id: 'agent_langflow_tars_rag',
      name: 'Langflow · TARS_tool',
      description: 'Design Dialogues with Langflow.',
      instructions: 'You are a thin wrapper around the Langflow "TARS_tool" flow.',
      provider: 'openAI',
      model: 'gpt-5.4-mini',
      author: ownerId,
    });

    await reconcile([
      { ...flow('TARS_tool', 'tars_rag'), description: 'Design Dialogues with Langflow.' },
    ]);

    const rows = await db.getAgents({ id: 'agent_langflow_tars_rag' });
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Workflow · TARS_tool');
    expect(rows[0].description).toBe('Design Dialogues with workflow.');
    expect(rows[0].instructions).not.toMatch(/langflow/i);
  });

  it('removes agents whose flow is gone or no longer MCP-enabled', async () => {
    await reconcile([flow('TARS_tool', 'tars_rag'), flow('Simple Agent (1)', 'simple_agent_1')]);
    await reconcile([flow('TARS_tool', 'tars_rag')]);
    expect(await agentNames()).toEqual(['agent_langflow_tars_rag|Workflow · TARS_tool']);
  });

  it('leaves everything alone when Langflow is unreachable', async () => {
    await reconcile([flow('TARS_tool', 'tars_rag')]);

    global.fetch = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    clock += 60_000;
    await reconcileLangflowAgents({ user: { id: 'req-user' } });

    expect(await agentNames()).toEqual(['agent_langflow_tars_rag|Workflow · TARS_tool']);
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

  describe('personal flows', () => {
    let alice;
    let bob;
    const personalId = (user, tool) => `agent_langflow_p_${user._id}_my_${tool}`;
    const asUser = (user) => ({ id: user._id.toString(), tarsId: user.tarsId });

    beforeAll(async () => {
      alice = await mongoose.models.User.create({
        email: 'alice@example.com',
        provider: 'tars',
        tarsId: 'tars-alice',
      });
      bob = await mongoose.models.User.create({
        email: 'bob@example.com',
        provider: 'tars',
        tarsId: 'tars-bob',
      });
    });

    it("publishes a user's own flows as agents only they can use", async () => {
      await reconcile([flow('Shared', 'shared')], asUser(alice), {
        'tars-alice': [personalFlow('My Notes', 'notes')],
      });

      const [agent] = await db.getAgents({ id: personalId(alice, 'notes') });
      expect(agent.name).toBe('Workflow · My Notes');
      expect(agent.author.toString()).toBe(alice._id.toString());
      expect(agent.tools).toEqual(['my_notes_mcp_workflow']);
      expect(grantPermission).toHaveBeenCalledWith(
        expect.objectContaining({
          principalType: 'user',
          principalId: alice._id.toString(),
          resourceId: agent._id,
          accessRoleId: 'agent_viewer',
        }),
      );
      expect(await agentNames()).toEqual(['agent_langflow_shared|Workflow · Shared']);
    });

    it('removes a personal agent once its flow is unpublished', async () => {
      await reconcile([flow('Shared', 'shared')], asUser(alice), {
        'tars-alice': [personalFlow('My Notes', 'notes')],
      });
      await reconcile([flow('Shared', 'shared')], asUser(alice), { 'tars-alice': [] });

      expect(await db.getAgents({ id: new RegExp(`^agent_langflow_p_${alice._id}_`) })).toEqual([]);
    });

    it("never touches another user's personal agents", async () => {
      await reconcile([flow('Shared', 'shared')], asUser(bob), {
        'tars-bob': [personalFlow('Bob Report', 'report')],
      });
      await reconcile([flow('Shared', 'shared')], asUser(alice), { 'tars-alice': [] });

      expect(await db.getAgents({ id: personalId(bob, 'report') })).toHaveLength(1);
    });

    it("keeps the shared owner's own personal agents out of the shared clean-up", async () => {
      const owner = await mongoose.models.User.findById(ownerId);
      owner.tarsId = 'tars-owner';
      await owner.save();
      const asOwner = { id: ownerId.toString(), tarsId: 'tars-owner' };

      await reconcile([flow('Shared', 'shared')], asOwner, {
        'tars-owner': [personalFlow('Owner Draft', 'draft')],
      });
      await reconcile([flow('Shared', 'shared')], { id: 'req-user' });

      expect(await db.getAgents({ id: personalId(owner, 'draft') })).toHaveLength(1);
      expect(await db.getAgents({ id: 'agent_langflow_shared' })).toHaveLength(1);
    });

    it('syncs nothing personal for a user not linked to pwc_tars', async () => {
      await reconcile(
        [flow('Shared', 'shared')],
        { id: alice._id.toString() },
        {
          undefined: [personalFlow('Ghost', 'ghost')],
        },
      );

      expect(await db.getAgents({ id: new RegExp('^agent_langflow_p_') })).toEqual([]);
    });
  });
});
