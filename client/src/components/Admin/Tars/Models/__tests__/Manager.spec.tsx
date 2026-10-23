import React from 'react';
import userEvent from '@testing-library/user-event';
import { render, screen, within } from '@testing-library/react';
import type { TTarsModelProfile, TTarsModelPermission } from 'librechat-data-provider';
import ModelProfileManager from '../Manager';

type MutationOptions = {
  onSuccess?: (data: unknown) => void;
  onError?: (error: unknown) => void;
};

const profiles: TTarsModelProfile[] = [
  {
    id: 'p-2',
    name: 'qwen-local',
    version: 'v2',
    type: 'VLLM',
    description: '{"zh-TW":"地端模型","en-US":"On-prem model"}',
    status: 0,
    config: null,
    endpoint: 'http://10.0.0.5:8000',
    api_version: null,
    updated_at: '2026-09-01T00:00:00Z',
  },
  {
    id: 'p-1',
    name: 'gpt-5.4',
    version: null,
    type: 'CLOUD',
    description: 'Cloud model',
    status: 1,
    config: '{"max_token": 8192}',
    endpoint: 'https://api.openai.com/v1',
    api_version: '2024-10-21',
    updated_at: '2026-10-01T00:00:00Z',
  },
];

const mockShowToast = jest.fn();
const mockUpdate = jest.fn();
let mockQuery: { data?: TTarsModelProfile[]; isLoading: boolean; isError: boolean };
let mockUpdateResult: { ok: boolean; payload: unknown };
let mockPermissions: { data?: TTarsModelPermission[]; isLoading: boolean; isError: boolean };

/** gpt-5.4 is assigned (one group, an active and a disabled user); qwen-local is open to everyone. */
const permissions: TTarsModelPermission[] = [
  {
    model_profile_id: 'p-1',
    principals: [
      { principal_type: 'group', principal_id: 'g1', name: 'BOSS', email: null, is_active: true },
      { principal_type: 'user', principal_id: 'u1', name: 'Amy', email: 'amy@x', is_active: true },
      { principal_type: 'user', principal_id: 'u2', name: 'Bob', email: null, is_active: false },
    ],
  },
];

jest.mock('~/data-provider', () => ({
  useTarsModelProfilesQuery: () => mockQuery,
  useTarsModelPermissionsQuery: () => mockPermissions,
  useDeleteTarsModelProfileMutation: () => ({ mutate: jest.fn(), isLoading: false }),
  useUpdateTarsModelProfileMutation: (options: MutationOptions) => ({
    isLoading: false,
    variables: undefined,
    mutate: (variables: unknown) => {
      mockUpdate(variables);
      if (mockUpdateResult.ok) {
        options.onSuccess?.(mockUpdateResult.payload);
      } else {
        options.onError?.(mockUpdateResult.payload);
      }
    },
  }),
  useCreateTarsModelProfileMutation: () => ({ mutate: jest.fn(), isLoading: false }),
}));

/** Stands in for the assign dialog; its own spec covers what happens inside. */
jest.mock('../Assign', () => ({
  __esModule: true,
  default: ({ profile, onClose }: { profile: TTarsModelProfile; onClose: () => void }) => (
    <div role="dialog" aria-label={`assign:${profile.name}`}>
      <button type="button" data-testid="close-assign" onClick={onClose} />
    </div>
  ),
}));

jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: mockShowToast }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, options?: Record<string, string | number>) =>
    options ? `${key}:${Object.values(options).join(',')}` : key,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-US' } }),
}));

const bodyRows = () => screen.getAllByRole('row').slice(1);

describe('ModelProfileManager', () => {
  beforeEach(() => {
    mockShowToast.mockClear();
    mockUpdate.mockClear();
    mockQuery = { data: profiles, isLoading: false, isError: false };
    mockUpdateResult = { ok: true, payload: { profile: profiles[1], sync: null } };
    mockPermissions = { data: permissions, isLoading: false, isError: false };
  });

  it('shows nothing but the loader while the list loads', () => {
    mockQuery = { data: undefined, isLoading: true, isError: false };
    render(<ModelProfileManager />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('com_ui_tars_models_empty')).not.toBeInTheDocument();
  });

  it('tells a failed load apart from an empty list', () => {
    mockQuery = { data: undefined, isLoading: false, isError: true };
    render(<ModelProfileManager />);
    expect(screen.getByText('com_ui_tars_models_load_failed')).toBeInTheDocument();
    expect(screen.queryByText('com_ui_tars_models_empty')).not.toBeInTheDocument();
  });

  it('lists every profile by name with the description in the UI language', () => {
    render(<ModelProfileManager />);
    const rows = bodyRows();
    expect(within(rows[0]).getByText('gpt-5.4')).toBeInTheDocument();
    expect(within(rows[1]).getByText('qwen-local')).toBeInTheDocument();
    expect(within(rows[1]).getByText('On-prem model')).toBeInTheDocument();
    expect(screen.getByText('com_ui_tars_models_total:2')).toBeInTheDocument();
  });

  it('shows the version under the name and the API version under the endpoint', () => {
    render(<ModelProfileManager />);
    const [gpt, qwen] = bodyRows();
    expect(within(qwen).getByText('com_ui_tars_models_version v2')).toBeInTheDocument();
    expect(within(gpt).getByText('com_ui_tars_models_api_version 2024-10-21')).toBeInTheDocument();
    expect(within(gpt).queryByText(/^com_ui_tars_models_version /)).not.toBeInTheDocument();
    expect(within(qwen).queryByText(/^com_ui_tars_models_api_version /)).not.toBeInTheDocument();
  });

  it('marks a model nobody is assigned to as open to everyone and counts the rest', () => {
    render(<ModelProfileManager />);
    const [gpt, qwen] = bodyRows();
    const openToAll = within(qwen).getAllByRole('img', { name: 'com_ui_tars_models_open_to_all' });
    expect(openToAll).toHaveLength(2);
    openToAll.forEach((cell) => expect(cell).toHaveTextContent('\u221E'));
    expect(
      within(gpt).queryByRole('img', { name: 'com_ui_tars_models_open_to_all' }),
    ).not.toBeInTheDocument();
    expect(
      within(gpt).getByRole('button', { name: 'com_ui_tars_models_users_title:gpt-5.4,2' }),
    ).toHaveTextContent('2');
    expect(
      within(gpt).getByRole('button', { name: 'com_ui_tars_models_groups_title:gpt-5.4,1' }),
    ).toHaveTextContent('1');
  });

  it('lists the assigned users by name, disabled ones marked', async () => {
    const user = userEvent.setup();
    render(<ModelProfileManager />);
    await user.click(
      screen.getByRole('button', { name: 'com_ui_tars_models_users_title:gpt-5.4,2' }),
    );
    expect(screen.getByText('Amy')).toBeInTheDocument();
    expect(screen.getByText('amy@x')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('com_ui_tars_mcp_disabled')).toBeInTheDocument();
  });

  it('does not call a model open to everyone before its assignees have loaded', () => {
    mockPermissions = { data: undefined, isLoading: true, isError: false };
    render(<ModelProfileManager />);
    expect(
      screen.queryByRole('img', { name: 'com_ui_tars_models_open_to_all' }),
    ).not.toBeInTheDocument();
  });

  it('opens the assign dialog for the chosen model', async () => {
    const user = userEvent.setup();
    render(<ModelProfileManager />);
    await user.click(
      screen.getByRole('button', { name: 'com_ui_tars_models_assign_title:qwen-local' }),
    );
    expect(screen.getByRole('dialog', { name: 'assign:qwen-local' })).toBeInTheDocument();

    await user.click(screen.getByTestId('close-assign'));
    expect(screen.queryByRole('dialog', { name: 'assign:qwen-local' })).not.toBeInTheDocument();
  });

  it('searches across name, type, endpoint and description', async () => {
    const user = userEvent.setup();
    render(<ModelProfileManager />);
    await user.type(screen.getByRole('textbox', { name: 'com_ui_tars_models_search' }), '10.0.0');
    expect(bodyRows()).toHaveLength(1);
    expect(screen.getByText('qwen-local')).toBeInTheDocument();

    await user.clear(screen.getByRole('textbox', { name: 'com_ui_tars_models_search' }));
    await user.type(screen.getByRole('textbox', { name: 'com_ui_tars_models_search' }), 'nothing');
    expect(screen.getByText('com_ui_tars_models_empty')).toBeInTheDocument();
  });

  it('enables a model straight away', async () => {
    const user = userEvent.setup();
    render(<ModelProfileManager />);
    await user.click(screen.getByRole('switch', { name: 'com_ui_tars_models_toggle:qwen-local' }));
    expect(mockUpdate).toHaveBeenCalledWith({ id: 'p-2', data: { enabled: true } });
  });

  it('asks before disabling, then reports where the settings moved', async () => {
    mockUpdateResult = {
      ok: true,
      payload: {
        profile: { ...profiles[1], status: 0 },
        sync: {
          target: { id: 'd', name: 'default' },
          knowledge_base: 1,
          sys_model: 1,
          sys_rag_model: 0,
          sys_domain: 0,
        },
      },
    };
    const user = userEvent.setup();
    render(<ModelProfileManager />);
    await user.click(screen.getByRole('switch', { name: 'com_ui_tars_models_toggle:gpt-5.4' }));
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(screen.getByText('com_ui_tars_models_cascade_warning')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'com_ui_tars_models_disable_action' }));
    expect(mockUpdate).toHaveBeenCalledWith({ id: 'p-1', data: { enabled: false } });
    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'com_ui_tars_models_disabled_toast:gpt-5.4 com_ui_tars_models_sync_moved:2,default',
      status: 'success',
    });
  });

  it('explains a refused disable when no default model can take over', async () => {
    mockUpdateResult = { ok: false, payload: { response: { status: 409, data: {} } } };
    const user = userEvent.setup();
    render(<ModelProfileManager />);
    await user.click(screen.getByRole('switch', { name: 'com_ui_tars_models_toggle:gpt-5.4' }));
    await user.click(screen.getByRole('button', { name: 'com_ui_tars_models_disable_action' }));
    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'com_ui_tars_models_no_fallback',
      status: 'error',
    });
  });
});
