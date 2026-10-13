import type { WorkflowSweepDeps } from './transfer';
import type { TarsAccount } from '~/tars/users';
import { removePersonalWorkflowAgents } from '~/langflow/sync';
import { buildWorkflowAccessDirectory } from './access';
import { sweepWorkflowAccounts } from './transfer';

const account = (id: string, overrides: Partial<TarsAccount> = {}): TarsAccount => ({
  id,
  username: id,
  email: null,
  role_id: 109,
  user_group_id: null,
  display_name: null,
  status: 'active',
  ...overrides,
});

const pwcTars = buildWorkflowAccessDirectory(
  [
    account('keeps', { role_id: 200 }),
    account('revoked', { display_name: '王小明' }),
    account('disabled', { role_id: 200, status: 'inactive' }),
  ],
  [],
  [
    { id: 109, librechat_menu_keys: 'kb.list' },
    { id: 200, librechat_menu_keys: 'admin.langflow' },
  ],
);

const langflowAccounts = ['keeps', 'revoked', 'disabled', 'deleted'].map((tarsId) => ({
  tarsId,
  username: `lf-${tarsId}`,
  lastLoginAt: null,
}));

const depsWith = (overrides: Partial<WorkflowSweepDeps> = {}): WorkflowSweepDeps => ({
  readSecret: () => 'secret',
  readOrigin: () => 'http://langflow:7860',
  fetchAccounts: jest.fn().mockResolvedValue(langflowAccounts),
  loadDirectory: jest.fn().mockResolvedValue(pwcTars),
  transfer: jest.fn().mockResolvedValue({ moved: 1, project: 'x', deactivated: false }),
  removePersonalAgents: jest.fn().mockResolvedValue(1),
  ...overrides,
});

describe('sweepWorkflowAccounts', () => {
  it('hands over the flows of everyone who lost Workflow, and only theirs', async () => {
    const deps = depsWith();

    const result = await sweepWorkflowAccounts(deps);

    expect(result).toEqual({ checked: 4, transferred: 3 });
    expect(deps.transfer).toHaveBeenCalledTimes(3);
    expect(deps.transfer).toHaveBeenCalledWith('http://langflow:7860', 'secret', 'revoked', {
      label: '王小明',
      deactivate: false,
    });
    expect(deps.transfer).toHaveBeenCalledWith('http://langflow:7860', 'secret', 'disabled', {
      label: 'disabled',
      deactivate: false,
    });
    expect(deps.transfer).toHaveBeenCalledWith('http://langflow:7860', 'secret', 'deleted', {
      label: 'lf-deleted',
      deactivate: true,
    });
    expect(deps.transfer).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'keeps',
      expect.anything(),
    );
    expect(deps.removePersonalAgents).toHaveBeenCalledWith('revoked');
  });

  it('does nothing when pwc_tars cannot be read', async () => {
    const deps = depsWith({ loadDirectory: jest.fn().mockRejectedValue(new Error('down')) });

    await expect(sweepWorkflowAccounts(deps)).rejects.toThrow('down');
    expect(deps.transfer).not.toHaveBeenCalled();
  });

  it('never reads an empty pwc_tars user list as everyone deleted', async () => {
    const deps = depsWith({
      loadDirectory: jest.fn().mockResolvedValue(buildWorkflowAccessDirectory([], [], [])),
    });

    expect(await sweepWorkflowAccounts(deps)).toEqual({ checked: 0, transferred: 0 });
    expect(deps.transfer).not.toHaveBeenCalled();
  });

  it('skips pwc_tars entirely while no one has entered Workflow', async () => {
    const deps = depsWith({ fetchAccounts: jest.fn().mockResolvedValue([]) });

    await sweepWorkflowAccounts(deps);

    expect(deps.loadDirectory).not.toHaveBeenCalled();
  });

  it('keeps going when one hand-over fails', async () => {
    const transfer = jest
      .fn()
      .mockRejectedValueOnce(new Error('langflow hiccup'))
      .mockResolvedValue({ moved: 2, project: 'x', deactivated: false });
    const deps = depsWith({ transfer });

    const result = await sweepWorkflowAccounts(deps);

    expect(transfer).toHaveBeenCalledTimes(3);
    expect(result.transferred).toBe(2);
  });

  it('does nothing until sign-in is configured', async () => {
    const deps = depsWith({ readSecret: () => null });

    expect(await sweepWorkflowAccounts(deps)).toEqual({ checked: 0, transferred: 0 });
    expect(deps.fetchAccounts).not.toHaveBeenCalled();
  });
});

describe('removePersonalWorkflowAgents', () => {
  it("removes exactly that user's personal Workflow agents", async () => {
    const agents = [{ _id: 'a1', id: 'agent_langflow_p_u1_my_notes' }];
    const getAgents = jest.fn().mockResolvedValue(agents);
    const deleteAgent = jest.fn().mockResolvedValue(undefined);

    expect(await removePersonalWorkflowAgents({ getAgents, deleteAgent }, 'u1')).toBe(1);
    expect(getAgents.mock.calls[0][0].id.source).toBe('^agent_langflow_p_u1_');
    expect(deleteAgent).toHaveBeenCalledWith({ _id: 'a1' });
  });
});
