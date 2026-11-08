/**
 * Integration test for the Langflow → Workflow agent reconcile.
 *
 * Each Langflow project with a published flow becomes one agent, whose tools are that project's
 * flows on the project's own MCP server (`workflow_<first 8 hex of the project id>`). The agent id
 * follows the project id, so a renamed project renames its agent in place. Shared projects (the
 * system account's) become agents everyone can use; a user's own projects become agents only they
 * can use. Only the outbound Langflow call and the ACL grant are stubbed; the agent writes are real.
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
const STARTER = { id: '1a2b3c4d-0000-4000-8000-000000000001', name: 'Starter Project' };
const CLAIMS = { id: '5e6f7a8b-0000-4000-8000-000000000002', name: 'Expense_Claim_Test' };
const STARTER_SERVER = 'workflow_1a2b3c4d';
const CLAIMS_SERVER = 'workflow_5e6f7a8b';

/** One row of Langflow's `GET /api/v1/tars/flows`: a shared (system account) flow. */
const flow = (name, toolName, { project = STARTER, model } = {}) => ({
  tool_name: toolName,
  flow_id: `flow-${toolName}`,
  name,
  description: `${name} description`,
  owner: 'system',
  tars_model: model ?? null,
  action_name: toolName,
  project_id: project.id,
  project_name: project.name,
  project_description: project.description ?? '',
  project_tool_name: toolName,
});

/** A flow of the chatting user's own; the aggregate server names its tool with a `my_` prefix. */
const personalFlow = (name, toolName, project) => ({
  ...flow(name, toolName, { project }),
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

  const sharedId = (server) => `agent_langflow_${server}`;
  const getAgent = async (id) => (await db.getAgents({ id }))[0];

  it('creates one shared agent per project, with every published flow as its tools', async () => {
    await reconcile([
      flow('TARS_tool', 'tars_tool'),
      flow('高雄小導遊', '_1'),
      flow('Claims', 'claims', { project: CLAIMS }),
    ]);

    expect(await agentNames()).toEqual([
      `${sharedId(STARTER_SERVER)}|Workflow · Starter Project`,
      `${sharedId(CLAIMS_SERVER)}|Workflow · Expense_Claim_Test`,
    ]);
    const starter = await getAgent(sharedId(STARTER_SERVER));
    expect(starter.tools).toEqual([`tars_tool_mcp_${STARTER_SERVER}`, `_1_mcp_${STARTER_SERVER}`]);
    expect(starter.mcpServerNames).toEqual([STARTER_SERVER]);
    expect(starter.description).toBe('TARS_tool、高雄小導遊');
    expect(starter.instructions).toContain('- _1: 高雄小導遊');
  });

  it("names the agent's tools as the project's own server does, not the aggregate", async () => {
    await reconcile([{ ...flow('guide copy', 'guide'), tool_name: 'guide_1' }]);

    expect((await getAgent(sharedId(STARTER_SERVER))).tools).toEqual([
      `guide_mcp_${STARTER_SERVER}`,
    ]);
  });

  it('renames the agent in place when the project is renamed', async () => {
    await reconcile([flow('TARS_tool', 'tars_tool')]);
    const before = await getAgent(sharedId(STARTER_SERVER));

    await reconcile([flow('TARS_tool', 'tars_tool', { project: { ...STARTER, name: 'Renamed' } })]);

    const after = await db.getAgents({ id: sharedId(STARTER_SERVER) });
    expect(after).toHaveLength(1);
    expect(after[0].name).toBe('Workflow · Renamed');
    expect(after[0]._id.toString()).toBe(before._id.toString());
    expect(after[0].instructions).toContain('"Renamed" workflow project');
  });

  it('follows a flow joining and leaving the project', async () => {
    await reconcile([flow('A', 'a')]);
    await reconcile([flow('A', 'a'), flow('B', 'b')]);
    expect((await getAgent(sharedId(STARTER_SERVER))).tools).toEqual([
      `a_mcp_${STARTER_SERVER}`,
      `b_mcp_${STARTER_SERVER}`,
    ]);

    await reconcile([flow('B', 'b')]);
    expect((await getAgent(sharedId(STARTER_SERVER))).tools).toEqual([`b_mcp_${STARTER_SERVER}`]);
  });

  it('replaces the per-flow agents published before projects', async () => {
    await mongoose.models.Agent.create({
      id: 'agent_langflow_tars_rag',
      name: 'Workflow · TARS_RAG',
      tools: ['tars_rag_mcp_workflow'],
      provider: 'openAI',
      model: 'gpt-5.4-mini',
      author: ownerId,
    });

    await reconcile([flow('TARS_RAG', 'tars_rag')]);

    expect(await agentNames()).toEqual([`${sharedId(STARTER_SERVER)}|Workflow · Starter Project`]);
  });

  it('removes duplicate rows a create-only pass left behind', async () => {
    const row = { provider: 'openAI', model: 'gpt-5.4-mini', author: ownerId };
    await mongoose.models.Agent.insertMany([
      { ...row, id: sharedId(STARTER_SERVER), name: 'Workflow · Old' },
      { ...row, id: sharedId(STARTER_SERVER), name: 'Workflow · Older' },
    ]);

    await reconcile([flow('TARS_tool', 'tars_tool')]);

    const rows = await db.getAgents({ id: sharedId(STARTER_SERVER) });
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Workflow · Starter Project');
  });

  it("rewrites the brand in a project's description", async () => {
    await reconcile([
      flow('TARS_tool', 'tars_tool', {
        project: { ...STARTER, description: 'Design Dialogues with Langflow.' },
      }),
    ]);

    const agent = await getAgent(sharedId(STARTER_SERVER));
    expect(agent.description).toBe('Design Dialogues with workflow.');
    expect(agent.instructions).not.toMatch(/langflow/i);
  });

  it('removes the agent of a project with nothing published any more', async () => {
    await reconcile([
      flow('TARS_tool', 'tars_tool'),
      flow('Claims', 'claims', { project: CLAIMS }),
    ]);
    await reconcile([flow('TARS_tool', 'tars_tool')]);
    expect(await agentNames()).toEqual([`${sharedId(STARTER_SERVER)}|Workflow · Starter Project`]);
  });

  it('leaves everything alone when Langflow is unreachable', async () => {
    await reconcile([flow('TARS_tool', 'tars_tool')]);

    global.fetch = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    clock += 60_000;
    await reconcileLangflowAgents({ user: { id: 'req-user' } });

    expect(await agentNames()).toEqual([`${sharedId(STARTER_SERVER)}|Workflow · Starter Project`]);
  });

  it('leaves everything alone when Langflow predates per-project servers', async () => {
    await mongoose.models.Agent.create({
      id: 'agent_langflow_tars_rag',
      name: 'Workflow · TARS_RAG',
      provider: 'openAI',
      model: 'gpt-5.4-mini',
      author: ownerId,
    });
    const { project_id: _id, project_tool_name: _tool, ...legacy } = flow('TARS_RAG', 'tars_rag');

    await reconcile([legacy]);

    expect(await agentNames()).toEqual(['agent_langflow_tars_rag|Workflow · TARS_RAG']);
  });

  it("orchestrates on the model the project's flows agree on", async () => {
    await reconcile([
      flow('A', 'a', { model: 'gemini-3.6-flash' }),
      flow('B', 'b', { model: 'gemini-3.6-flash' }),
      flow('C', 'c'),
    ]);
    const agent = await getAgent(sharedId(STARTER_SERVER));
    expect(agent.provider).toBe('google');
    expect(agent.model).toBe('gemini-3.6-flash');
  });

  it('falls back to the configured default when the flows name different models', async () => {
    await reconcile([
      flow('A', 'a', { model: 'gemini-3.6-flash' }),
      flow('B', 'b', { model: 'gpt-5.5' }),
    ]);
    const agent = await getAgent(sharedId(STARTER_SERVER));
    expect(agent.provider).toBe('openAI');
    expect(agent.model).toBe('gpt-5.4-mini');
  });

  it('leaves a hand-tuned model alone while no flow names one', async () => {
    await reconcile([flow('TARS_tool', 'tars_tool')]);
    await db.updateAgent(
      { id: sharedId(STARTER_SERVER) },
      { provider: 'google', model: 'gemini-3.6-flash' },
      { skipVersioning: true },
    );

    await reconcile([flow('TARS_tool', 'tars_tool')]);

    expect((await getAgent(sharedId(STARTER_SERVER))).model).toBe('gemini-3.6-flash');
  });

  it('keeps the existing model when the flows name one no endpoint serves', async () => {
    await reconcile([flow('TARS_tool', 'tars_tool', { model: 'some-unconfigured-model' })]);
    expect((await getAgent(sharedId(STARTER_SERVER))).model).toBe('gpt-5.4-mini');
  });

  it('is a no-op on a second identical pass', async () => {
    await reconcile([flow('TARS_tool', 'tars_tool', { model: 'gemini-3.6-flash' })]);
    const first = await getAgent(sharedId(STARTER_SERVER));
    await reconcile([flow('TARS_tool', 'tars_tool', { model: 'gemini-3.6-flash' })]);
    const second = await getAgent(sharedId(STARTER_SERVER));
    expect(second.updatedAt.getTime()).toBe(first.updatedAt.getTime());
  });

  it('moves agents users built on the aggregate server onto the project servers', async () => {
    const builder = await mongoose.models.User.create({ email: 'builder@example.com' });
    await mongoose.models.Agent.create({
      id: 'agent_built_by_hand',
      name: 'My helper',
      tools: ['guide_1_mcp_workflow', 'gone_mcp_workflow', 'web_search'],
      mcpServerNames: ['workflow'],
      provider: 'openAI',
      model: 'gpt-5.4-mini',
      author: builder._id,
    });

    await reconcile([
      { ...flow('guide copy', 'guide', { project: CLAIMS }), tool_name: 'guide_1' },
    ]);

    const agent = await getAgent('agent_built_by_hand');
    expect(agent.tools).toEqual([`guide_mcp_${CLAIMS_SERVER}`, 'gone_mcp_workflow', 'web_search']);
    expect(agent.mcpServerNames).toEqual(['workflow', CLAIMS_SERVER]);
  });

  describe('personal projects', () => {
    let alice;
    let bob;
    const MINE = { id: 'abcdef01-0000-4000-8000-000000000003', name: 'My Project' };
    const MINE_SERVER = 'workflow_abcdef01';
    const personalId = (user) => `agent_langflow_p_${user._id}_${MINE_SERVER}`;
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

    it("publishes a user's own projects as agents only they can use", async () => {
      await reconcile([flow('Shared', 'shared')], asUser(alice), {
        'tars-alice': [personalFlow('My Notes', 'notes', MINE)],
      });

      const agent = await getAgent(personalId(alice));
      expect(agent.name).toBe('Workflow · 我的 - My Project');
      expect(agent.author.toString()).toBe(alice._id.toString());
      expect(agent.tools).toEqual([`notes_mcp_${MINE_SERVER}`]);
      expect(grantPermission).toHaveBeenCalledWith(
        expect.objectContaining({
          principalType: 'user',
          principalId: alice._id.toString(),
          resourceId: agent._id,
          accessRoleId: 'agent_viewer',
        }),
      );
      expect(await agentNames()).toEqual([
        `${sharedId(STARTER_SERVER)}|Workflow · Starter Project`,
      ]);
    });

    it('removes a personal agent once its project has nothing published', async () => {
      await reconcile([flow('Shared', 'shared')], asUser(alice), {
        'tars-alice': [personalFlow('My Notes', 'notes', MINE)],
      });
      await reconcile([flow('Shared', 'shared')], asUser(alice), { 'tars-alice': [] });

      expect(await db.getAgents({ id: new RegExp(`^agent_langflow_p_${alice._id}_`) })).toEqual([]);
    });

    it("never touches another user's personal agents", async () => {
      await reconcile([flow('Shared', 'shared')], asUser(bob), {
        'tars-bob': [personalFlow('Bob Report', 'report', MINE)],
      });
      await reconcile([flow('Shared', 'shared')], asUser(alice), { 'tars-alice': [] });

      expect(await db.getAgents({ id: personalId(bob) })).toHaveLength(1);
    });

    it("keeps the shared owner's own personal agents out of the shared clean-up", async () => {
      const owner = await mongoose.models.User.findById(ownerId);
      owner.tarsId = 'tars-owner';
      await owner.save();
      const asOwner = { id: ownerId.toString(), tarsId: 'tars-owner' };

      await reconcile([flow('Shared', 'shared')], asOwner, {
        'tars-owner': [personalFlow('Owner Draft', 'draft', MINE)],
      });
      await reconcile([flow('Shared', 'shared')], { id: 'req-user' });

      expect(await db.getAgents({ id: personalId(owner) })).toHaveLength(1);
      expect(await db.getAgents({ id: sharedId(STARTER_SERVER) })).toHaveLength(1);
    });

    it("moves only the user's own agents off their aggregate tools", async () => {
      const row = { provider: 'openAI', model: 'gpt-5.4-mini', mcpServerNames: ['workflow'] };
      await mongoose.models.Agent.create([
        { ...row, id: 'agent_alice_own', tools: ['my_notes_mcp_workflow'], author: alice._id },
        { ...row, id: 'agent_bob_own', tools: ['my_notes_mcp_workflow'], author: bob._id },
      ]);

      await reconcile([flow('Shared', 'shared')], asUser(alice), {
        'tars-alice': [personalFlow('My Notes', 'notes', MINE)],
      });

      expect((await getAgent('agent_alice_own')).tools).toEqual([`notes_mcp_${MINE_SERVER}`]);
      expect((await getAgent('agent_alice_own')).mcpServerNames).toEqual([MINE_SERVER]);
      expect((await getAgent('agent_bob_own')).tools).toEqual(['my_notes_mcp_workflow']);
    });

    it('syncs nothing personal for a user not linked to pwc_tars', async () => {
      await reconcile(
        [flow('Shared', 'shared')],
        { id: alice._id.toString() },
        {
          undefined: [personalFlow('Ghost', 'ghost', MINE)],
        },
      );

      expect(await db.getAgents({ id: new RegExp('^agent_langflow_p_') })).toEqual([]);
    });
  });
});
