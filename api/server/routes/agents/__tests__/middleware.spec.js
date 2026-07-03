jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

const mockRemoteAgentAuth = jest.fn((req, res, next) => next());
const mockIsEnabled = jest.fn().mockReturnValue(false);
jest.mock('@librechat/api', () => ({
  isEnabled: (...args) => mockIsEnabled(...args),
  generateCheckAccess: jest.fn(() => (req, res, next) => next()),
  preAuthTenantMiddleware: (req, res, next) => next(),
  createRequireApiKeyAuth: jest.fn(() => (req, res, next) => next()),
  createRemoteAgentAuth: jest.fn(() => mockRemoteAgentAuth),
  createCheckRemoteAgentAccess: jest.fn(() => (req, res, next) => next()),
}));

jest.mock('~/server/services/PermissionService', () => ({
  getEffectivePermissions: jest.fn(),
}));
jest.mock('~/server/services/Config', () => ({
  getAppConfig: jest.fn(),
}));

const mockGetUserById = jest.fn();
jest.mock('~/models', () => ({
  getAgent: jest.fn(),
  findUser: jest.fn(),
  updateUser: jest.fn(),
  getRoleByName: jest.fn(),
  findRolesByNames: jest.fn(),
  validateAgentApiKey: jest.fn(),
  getUserById: (...args) => mockGetUserById(...args),
}));

const { gatewayServiceAuth } = require('~/server/routes/agents/middleware');

const SERVICE_KEY = 'gateway-secret';
const REAL_USER_ID = 'abcdefabcdefabcdefabcdef';
const SYNTHETIC_USER_ID = '000000000000000000000000';

function createReq({ token = SERVICE_KEY, userHeader } = {}) {
  const headers = {};
  if (token != null) {
    headers.authorization = `Bearer ${token}`;
  }
  if (userHeader != null) {
    headers['x-librechat-user-id'] = userHeader;
  }
  return { headers };
}

describe('gatewayServiceAuth – acting user resolution', () => {
  const savedServiceKey = process.env.LLM_GATEWAY_SERVICE_KEY;

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsEnabled.mockReturnValue(false);
    process.env.LLM_GATEWAY_SERVICE_KEY = SERVICE_KEY;
  });

  afterAll(() => {
    if (savedServiceKey === undefined) {
      delete process.env.LLM_GATEWAY_SERVICE_KEY;
    } else {
      process.env.LLM_GATEWAY_SERVICE_KEY = savedServiceKey;
    }
  });

  it('attaches the real user when service-authorized with a valid header', async () => {
    mockGetUserById.mockResolvedValue({ _id: REAL_USER_ID, name: 'Real User' });
    const req = createReq({ userHeader: REAL_USER_ID });
    const next = jest.fn();

    await gatewayServiceAuth(req, {}, next);

    expect(mockGetUserById).toHaveBeenCalledWith(REAL_USER_ID, expect.any(String));
    expect(req.user.id).toBe(REAL_USER_ID);
    expect(req.user.role).toBe('USER');
    expect(req.gatewayServiceAuth).toBe(true);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('keeps the synthetic user on a malformed header without a db lookup', async () => {
    const req = createReq({ userHeader: 'not-an-object-id' });
    const next = jest.fn();

    await gatewayServiceAuth(req, {}, next);

    expect(mockGetUserById).not.toHaveBeenCalled();
    expect(req.user.id).toBe(SYNTHETIC_USER_ID);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('keeps the synthetic user when the header user is unknown', async () => {
    mockGetUserById.mockResolvedValue(null);
    const req = createReq({ userHeader: REAL_USER_ID });
    const next = jest.fn();

    await gatewayServiceAuth(req, {}, next);

    expect(req.user.id).toBe(SYNTHETIC_USER_ID);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('keeps the synthetic user when the db lookup throws', async () => {
    mockGetUserById.mockRejectedValue(new Error('db down'));
    const req = createReq({ userHeader: REAL_USER_ID });
    const next = jest.fn();

    await gatewayServiceAuth(req, {}, next);

    expect(req.user.id).toBe(SYNTHETIC_USER_ID);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('ignores the header entirely on the remote-agent auth path', async () => {
    const req = createReq({ token: 'wrong-token', userHeader: REAL_USER_ID });
    const next = jest.fn();

    await gatewayServiceAuth(req, {}, next);

    expect(mockRemoteAgentAuth).toHaveBeenCalledTimes(1);
    expect(mockGetUserById).not.toHaveBeenCalled();
    expect(req.user).toBeUndefined();
    expect(req.gatewayServiceAuth).toBeUndefined();
  });

  it('resolves the acting user in unauthenticated mode as well', async () => {
    delete process.env.LLM_GATEWAY_SERVICE_KEY;
    mockIsEnabled.mockReturnValue(true);
    mockGetUserById.mockResolvedValue({ _id: REAL_USER_ID });
    const req = createReq({ token: null, userHeader: REAL_USER_ID });
    const next = jest.fn();

    await gatewayServiceAuth(req, {}, next);

    expect(req.user.id).toBe(REAL_USER_ID);
    expect(req.gatewayServiceAuth).toBe(true);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
