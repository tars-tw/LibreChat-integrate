import React from 'react';
import userEvent from '@testing-library/user-event';
import { act, render, screen } from '@testing-library/react';
import type { TTarsDatasetLevelResult } from 'librechat-data-provider';
import LevelDialog, { LevelChip } from '../Level';

type MutationOptions = {
  onSuccess?: (data: { result: TTarsDatasetLevelResult }) => void;
  onError?: (error: unknown) => void;
};

const mockSetLevel = jest.fn();
const mockShowToast = jest.fn();
const options: { current?: MutationOptions } = {};

const LEVELS = [
  { id: '1', name: '高度機密', description: null, order: 1 },
  { id: '2', name: '機密', description: null, order: 2 },
];

jest.mock('~/data-provider', () => ({
  useSetTarsDatasetLevelMutation: (_kb: string, opts: MutationOptions) => {
    options.current = opts;
    return { mutate: mockSetLevel, isLoading: false };
  },
}));

/** The real one is an Ariakit select; a native one keeps these tests about the dialog. */
jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: mockShowToast }),
  Dropdown: ({
    value,
    onChange,
    options: choices,
    placeholder,
    'aria-labelledby': labelledBy,
  }: {
    value: string;
    onChange: (value: string) => void;
    options: { value: string; label: string }[];
    placeholder?: string;
    'aria-labelledby'?: string;
  }) => (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-labelledby={labelledBy}
    >
      <option value="" disabled>
        {placeholder}
      </option>
      {choices.map((choice) => (
        <option key={choice.value} value={choice.value}>
          {choice.label}
        </option>
      ))}
    </select>
  ),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, params?: Record<string, string>) =>
    params?.[0] != null ? `${key} ${params[0]}` : key,
}));

const picker = () => screen.getByRole('combobox', { name: 'com_ui_tars_kb_level' });
const saveButton = () => screen.getByRole('button', { name: 'com_ui_save' });

const result = (partial: Partial<TTarsDatasetLevelResult>): TTarsDatasetLevelResult => ({
  knowledge_base_id: 'kb-1',
  data_security_level_id: '1',
  document_count: 0,
  website_count: 0,
  file_system_count: 0,
  inherited_document_count: 0,
  ...partial,
});

beforeEach(() => {
  mockSetLevel.mockClear();
  mockShowToast.mockClear();
});

describe('LevelChip', () => {
  it('shows a dash for data with no level', () => {
    render(<LevelChip levels={LEVELS} levelId={null} />);

    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows the level by name', () => {
    render(<LevelChip levels={LEVELS} levelId="2" />);

    expect(screen.getByText('機密')).toBeInTheDocument();
  });

  it('still shows a label when the levels have not loaded', () => {
    render(<LevelChip levels={[]} levelId="2" />);

    expect(screen.getByText('2')).toBeInTheDocument();
  });
});

describe('LevelDialog', () => {
  const renderDialog = (props: Partial<React.ComponentProps<typeof LevelDialog>> = {}) =>
    render(
      <LevelDialog
        knowledgeBaseId="kb-1"
        levels={LEVELS}
        name="report.pdf"
        targets={{ documentIds: ['d1'] }}
        onClose={jest.fn()}
        {...props}
      />,
    );

  it('saves one dataset only once its level changes', async () => {
    const user = userEvent.setup();
    renderDialog({ currentLevelId: '2' });

    expect(picker()).toHaveValue('2');
    expect(saveButton()).toBeDisabled();

    await user.selectOptions(picker(), '1');
    await user.click(saveButton());

    expect(mockSetLevel).toHaveBeenCalledWith({ documentIds: ['d1'], dataSecurityLevelId: '1' });
  });

  it('clears a level with an explicit null', async () => {
    const user = userEvent.setup();
    renderDialog({ currentLevelId: '1' });

    await user.selectOptions(picker(), 'com_ui_tars_kb_level_none');
    await user.click(saveButton());

    expect(mockSetLevel).toHaveBeenCalledWith({ documentIds: ['d1'], dataSecurityLevelId: null });
  });

  it('preselects nothing for a selection, so clearing it must be picked', async () => {
    const user = userEvent.setup();
    renderDialog({ name: '3', targets: { websiteIds: ['w1', 'w2', 'w3'] } });

    expect(picker()).toHaveValue('');
    expect(saveButton()).toBeDisabled();

    await user.selectOptions(picker(), 'com_ui_tars_kb_level_none');
    await user.click(saveButton());

    expect(mockSetLevel).toHaveBeenCalledWith({
      websiteIds: ['w1', 'w2', 'w3'],
      dataSecurityLevelId: null,
    });
  });

  it('reports how many files a group changed, then closes', () => {
    const onClose = jest.fn();
    const onSaved = jest.fn();
    renderDialog({
      targets: { fileSystemAssociationIds: ['a1'] },
      note: 'com_ui_tars_kb_level_group_note',
      onSaved,
      onClose,
    });

    expect(screen.getByText('com_ui_tars_kb_level_group_note')).toBeInTheDocument();

    act(() =>
      options.current?.onSuccess?.({
        result: result({ file_system_count: 1, inherited_document_count: 15 }),
      }),
    );

    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'com_ui_tars_kb_level_group_saved 15',
      status: 'success',
    });
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("stays open on pwc_tars' refusal and shows its reason", () => {
    const onClose = jest.fn();
    renderDialog({ onClose });

    act(() =>
      options.current?.onError?.({ response: { data: { error: '文件不在這個知識庫：d1' } } }),
    );

    expect(mockShowToast).toHaveBeenCalledWith({
      message: '文件不在這個知識庫：d1',
      status: 'error',
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});
