import mongoose from 'mongoose';
import { EModelEndpoint } from 'librechat-data-provider';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { IConversation } from '~/types';
import { createConversationMethods } from '~/methods/conversation';
import { createModels } from '~/models';

jest.mock('~/config/winston', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));

const USER = 'user123';

let mongoServer: MongoMemoryServer;
let Conversation: mongoose.Model<IConversation>;
let methods: ReturnType<typeof createConversationMethods>;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  Object.assign(mongoose.models, createModels(mongoose));
  Conversation = mongoose.models.Conversation as mongoose.Model<IConversation>;
  methods = createConversationMethods(mongoose, {
    getMessages: jest.fn().mockResolvedValue([]),
    deleteMessages: jest.fn().mockResolvedValue({ deletedCount: 0 }),
    searchMessages: jest.fn().mockResolvedValue({ hits: [] }),
  });
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Conversation.deleteMany({});
  await Conversation.create(
    [
      { conversationId: 'plain', endpoint: EModelEndpoint.openAI },
      { conversationId: 'general', endpoint: EModelEndpoint.openAI, domain_id: '100' },
      {
        conversationId: 'general-ephemeral',
        endpoint: EModelEndpoint.agents,
        agent_id: 'ephemeral',
        domain_id: '100',
      },
      { conversationId: 'agent', endpoint: EModelEndpoint.agents, agent_id: 'agent_abc' },
      {
        conversationId: 'agent-bound-brain',
        endpoint: EModelEndpoint.agents,
        agent_id: 'agent_abc',
        domain_id: '201',
      },
      { conversationId: 'brain', endpoint: EModelEndpoint.openAI, domain_id: '201' },
      {
        conversationId: 'brain-ephemeral',
        endpoint: EModelEndpoint.agents,
        agent_id: 'ephemeral',
        domain_id: '202',
      },
      {
        conversationId: 'workflow',
        endpoint: EModelEndpoint.agents,
        agent_id: 'agent_langflow_tars_flow',
        domain_id: '100',
      },
      {
        conversationId: 'workflow-personal',
        endpoint: EModelEndpoint.agents,
        agent_id: 'agent_langflow_p_0123456789abcdef01234567_flow',
      },
    ].map((convo) => ({ ...convo, user: USER, title: convo.conversationId })),
  );
});

const VISIBLE = ['agent', 'agent-bound-brain', 'general', 'general-ephemeral', 'plain'];

describe('buildTarsHiddenConversationFilter', () => {
  it('drops Workflow and specialized-brain chats from the conversation list', async () => {
    const { conversations } = await methods.getConvosByCursor(USER, { limit: 50 });
    const ids = conversations.map((convo) => convo.conversationId).sort();
    expect(ids).toEqual(VISIBLE);
  });

  it('drops them from search results resolved by id', async () => {
    const all = await Conversation.find({ user: USER }, 'conversationId').lean();
    const { conversations } = await methods.getConvosQueried(USER, all, null, 50);
    const ids = conversations.map((convo) => convo.conversationId).sort();
    expect(ids).toEqual(VISIBLE);
  });

  it('keeps hidden chats reachable by id', async () => {
    const convo = await methods.getConvo(USER, 'brain');
    expect(convo?.conversationId).toBe('brain');
  });
});
