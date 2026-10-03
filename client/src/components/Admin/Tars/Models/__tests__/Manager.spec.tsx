import React from 'react';
import userEvent from '@testing-library/user-event';
import { render, screen, within } from '@testing-library/react';
import type { TTarsModelProfile } from 'librechat-data-provider';
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
    api_version: null,
    updated_at: '2026-10-01T00:00:00Z',
  },
];

const mockShowToast = jest.fn();
const mockUpdate = jest.fn();
let mockQuery: { data?: TTarsModelProfile[]; isLoading: boolean; isError: boolean };
let mockUpdateResult: { ok: boolean; payload: unknown };

jest.mock('~/data-provider', () => ({
  useTarsModelProfilesQuery: () => mockQuery,
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
