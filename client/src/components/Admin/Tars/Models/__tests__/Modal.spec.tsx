import React from 'react';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import type { TTarsModelProfile } from 'librechat-data-provider';
import ModelProfileModal from '../Modal';

const mockUpdate = jest.fn();
const mockCreate = jest.fn();

jest.mock('~/data-provider', () => ({
  useCreateTarsModelProfileMutation: () => ({ mutate: mockCreate, isLoading: false }),
  useUpdateTarsModelProfileMutation: () => ({ mutate: mockUpdate, isLoading: false }),
}));

jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: jest.fn() }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, options?: Record<string, string>) =>
    options ? `${key}:${Object.values(options).join(',')}` : key,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-US' } }),
}));

const profile: TTarsModelProfile = {
  id: 'p-1',
  name: 'gpt-5.4',
  version: null,
  type: 'CLOUD',
  description: null,
  status: 1,
  config: '{"is_multi_modal": true,"context_windows": 192000}',
  endpoint: 'https://api.openai.com/v1',
  api_version: null,
};

const configBox = () => screen.getByLabelText('com_ui_tars_models_config') as HTMLTextAreaElement;

const renderModal = (target?: TTarsModelProfile) =>
  render(
    <ModelProfileModal
      profile={target}
      profiles={target ? [target] : []}
      onOpenChange={jest.fn()}
    />,
  );

beforeEach(() => {
  mockUpdate.mockClear();
  mockCreate.mockClear();
});

describe('ModelProfileModal type and endpoint', () => {
  it('only lets the type be picked from the list', async () => {
    const user = userEvent.setup();
    renderModal();
    expect(screen.queryByRole('textbox', { name: /com_ui_tars_models_type/ })).toBeNull();

    await user.click(screen.getByRole('combobox', { name: /com_ui_tars_models_type/ }));
    expect(
      screen.getAllByRole('option', { hidden: true }).map((option) => option.textContent),
    ).toEqual([
      'com_ui_tars_models_type_select',
      'com_ui_tars_models_type_cloud',
      'com_ui_tars_models_type_vllm',
      'com_ui_tars_models_type_google_vertex',
    ]);
  });

  it('keeps a legacy type on offer when editing a row that still has one', async () => {
    const user = userEvent.setup();
    renderModal({ ...profile, type: 'OPEN_AI' });
    await user.click(screen.getByRole('combobox', { name: /com_ui_tars_models_type/ }));
    expect(
      screen.getByRole('option', { name: /com_ui_tars_models_type_legacy:OPEN_AI/, hidden: true }),
    ).toBeInTheDocument();
  });

  it('refuses an endpoint that is not an http(s) URL', async () => {
    const user = userEvent.setup();
    renderModal({ ...profile, endpoint: 'fasdfa' });
    const endpoint = screen.getByLabelText(/com_ui_tars_models_endpoint/);

    await user.click(screen.getByRole('button', { name: 'com_ui_save' }));
    expect(screen.getByText('com_ui_tars_models_endpoint_invalid')).toBeInTheDocument();
    expect(mockUpdate).not.toHaveBeenCalled();

    await user.clear(endpoint);
    await user.type(endpoint, 'ftp://10.0.0.5');
    await user.tab();
    expect(screen.getByText('com_ui_tars_models_endpoint_invalid')).toBeInTheDocument();

    await user.clear(endpoint);
    await user.type(endpoint, 'http://10.0.0.5:8000/v1');
    await user.click(screen.getByRole('button', { name: 'com_ui_save' }));
    expect(mockUpdate).toHaveBeenCalledWith({
      id: 'p-1',
      data: { endpoint: 'http://10.0.0.5:8000/v1' },
    });
  });
});

describe('ModelProfileModal config editor', () => {
  it('lays a pasted one-line JSON object out with indentation', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(configBox());
    await user.paste('{"thinking": {"mode": "toggleable", "levels": ["off", "low"]}, "x": 1}');
    expect(configBox().value).toBe(
      [
        '{',
        '  "thinking": {',
        '    "mode": "toggleable",',
        '    "levels": [',
        '      "off",',
        '      "low"',
        '    ]',
        '  },',
        '  "x": 1',
        '}',
      ].join('\n'),
    );
  });

  it('pastes anything that is not a whole JSON object as typed', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(configBox());
    await user.paste('{"partial": ');
    expect(configBox().value).toBe('{"partial": ');
  });

  it('formats on leaving the field, or flags it when it is not valid JSON', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(configBox());
    await user.paste('{"a": ');
    await user.tab();
    expect(screen.getByText('com_ui_tars_models_config_invalid')).toBeInTheDocument();

    await user.click(configBox());
    await user.paste('1}');
    await user.tab();
    expect(configBox().value).toBe('{\n  "a": 1\n}');
    expect(screen.queryByText('com_ui_tars_models_config_invalid')).not.toBeInTheDocument();
  });

  it('shows a stored config formatted without counting that as a change', async () => {
    const user = userEvent.setup();
    renderModal(profile);
    expect(configBox().value).toBe('{\n  "is_multi_modal": true,\n  "context_windows": 192000\n}');

    await user.click(screen.getByRole('button', { name: 'com_ui_save' }));
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
