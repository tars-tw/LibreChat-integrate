import jwt from 'jsonwebtoken';
import {
  WorkflowServiceError,
  fetchWorkflowFlows,
  resolveLangflowOrigin,
  requestWorkflowTransfer,
  fetchWorkflowAccounts,
  signWorkflowServiceToken,
} from './service';

const SECRET = 'workflow-service-test-secret-0123456789abcdef';

describe('Workflow service calls', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('signs a short-lived bearer under the service audience only', () => {
    const claims = jwt.verify(signWorkflowServiceToken(SECRET), SECRET, {
      issuer: 'librechat',
      audience: 'langflow-service',
    }) as jwt.JwtPayload;

    expect(claims.exp! - claims.iat!).toBe(60);
    expect(() =>
      jwt.verify(signWorkflowServiceToken(SECRET), SECRET, { audience: 'langflow' }),
    ).toThrow();
  });

  it('reads the Langflow accounts with that bearer', async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify([
          { tars_id: 'u-42', username: 'alice', last_login_at: '2026-10-11T08:00:00' },
        ]),
        { status: 200 },
      ),
    );

    const accounts = await fetchWorkflowAccounts('http://langflow:7860', SECRET);

    expect(accounts).toEqual([
      { tarsId: 'u-42', username: 'alice', lastLoginAt: '2026-10-11T08:00:00' },
    ]);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('http://langflow:7860/api/v1/tars/accounts');
    const bearer = (init.headers as Record<string, string>).Authorization.replace('Bearer ', '');
    expect(() => jwt.verify(bearer, SECRET, { audience: 'langflow-service' })).not.toThrow();
  });

  it('surfaces a refusal with its status', async () => {
    fetchSpy.mockResolvedValue(new Response('{}', { status: 401 }));

    await expect(fetchWorkflowAccounts('http://langflow:7860', SECRET)).rejects.toMatchObject({
      name: 'WorkflowServiceError',
      status: 401,
    });
  });

  it('surfaces an unreachable Langflow', async () => {
    fetchSpy.mockRejectedValue(new TypeError('fetch failed'));

    await expect(fetchWorkflowAccounts('http://langflow:7860', SECRET)).rejects.toBeInstanceOf(
      WorkflowServiceError,
    );
  });

  it('derives the origin from the configured Langflow address', () => {
    expect(resolveLangflowOrigin('http://langflow:7860/')).toBe('http://langflow:7860');
    expect(resolveLangflowOrigin(undefined)).toBeNull();
    expect(resolveLangflowOrigin('not a url')).toBeNull();
  });

  describe('fetchWorkflowFlows', () => {
    const row = {
      tool_name: 'my_notes',
      flow_id: 'f-1',
      name: 'My Notes',
      description: 'notes',
      owner: 'personal',
      tars_model: 'gpt-5.4-mini',
      action_name: 'notes',
    };

    it('asks with the system key on behalf of the chatting user and maps the rows', async () => {
      fetchSpy.mockResolvedValue(new Response(JSON.stringify([row]), { status: 200 }));

      const flows = await fetchWorkflowFlows('http://langflow:7860', 'system-key', 'tars-1');

      expect(flows).toEqual([
        {
          toolName: 'my_notes',
          flowId: 'f-1',
          name: 'My Notes',
          description: 'notes',
          owner: 'personal',
          tarsModel: 'gpt-5.4-mini',
          actionName: 'notes',
        },
      ]);
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe('http://langflow:7860/api/v1/tars/flows');
      expect(init.headers).toEqual({
        'x-api-key': 'system-key',
        'x-langflow-global-var-tars_user_id': 'tars-1',
      });
    });

    it('asks for the shared flows only when no one is chatting', async () => {
      fetchSpy.mockResolvedValue(new Response('[]', { status: 200 }));

      await fetchWorkflowFlows('http://langflow:7860', 'system-key');

      expect(fetchSpy.mock.calls[0][1].headers).toEqual({ 'x-api-key': 'system-key' });
    });

    it("says plainly when the key is not the system account's", async () => {
      fetchSpy.mockResolvedValue(new Response('{}', { status: 403 }));

      await expect(fetchWorkflowFlows('http://langflow:7860', 'personal-key')).rejects.toThrow(
        /system account/,
      );
    });
  });

  describe('requestWorkflowTransfer', () => {
    it('asks Langflow, with a service bearer, to hand the flows over', async () => {
      fetchSpy.mockResolvedValue(
        new Response(JSON.stringify({ moved: 2, project: '王小明（已移交）', deactivated: true }), {
          status: 200,
        }),
      );

      const result = await requestWorkflowTransfer('http://langflow:7860', SECRET, 'u 1', {
        label: '王小明',
        deactivate: true,
      });

      expect(result).toEqual({ moved: 2, project: '王小明（已移交）', deactivated: true });
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe('http://langflow:7860/api/v1/tars/accounts/u%201/transfer');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({ label: '王小明', deactivate: true });
      const bearer = (init.headers as Record<string, string>).Authorization.replace('Bearer ', '');
      expect(() => jwt.verify(bearer, SECRET, { audience: 'langflow-service' })).not.toThrow();
    });

    it('surfaces a refusal', async () => {
      fetchSpy.mockResolvedValue(new Response('{}', { status: 409 }));

      await expect(
        requestWorkflowTransfer('http://langflow:7860', SECRET, 'u1', {
          label: 'x',
          deactivate: false,
        }),
      ).rejects.toMatchObject({ status: 409 });
    });
  });
});
