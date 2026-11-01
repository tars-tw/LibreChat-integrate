import React from 'react';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import UploadDialog from '../UploadDialog';

const mockUpload = jest.fn();

const LEVELS = [{ id: '2', name: '機密', description: null, order: 2 }];
const LIMITS = { max_upload_counts: 5, max_chunk_size: 30000, max_overlap: 300 };

jest.mock('~/data-provider', () => ({
  useUploadTarsDocumentsMutation: () => ({ mutate: mockUpload, isLoading: false }),
}));

/** The real one is an Ariakit select; a native one keeps these tests about the dialog. */
jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: jest.fn() }),
  Dropdown: ({
    value,
    onChange,
    options,
    'aria-labelledby': labelledBy,
  }: {
    value: string;
    onChange: (value: string) => void;
    options: { value: string; label: string }[];
    'aria-labelledby'?: string;
  }) => (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-labelledby={labelledBy}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

const renderDialog = () =>
  render(
    <UploadDialog knowledgeBaseId="kb-1" levels={LEVELS} limits={LIMITS} onClose={jest.fn()} />,
  );

const addFile = (user: ReturnType<typeof userEvent.setup>) =>
  user.upload(
    screen.getByLabelText('com_ui_tars_kb_choose_files'),
    new File(['hello'], 'a.txt', { type: 'text/plain' }),
  );

const upload = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'com_ui_tars_kb_upload' }));

const sentForm = () => mockUpload.mock.calls[0][0] as FormData;

beforeEach(() => mockUpload.mockClear());

describe('UploadDialog data level', () => {
  it('defaults to no level and sends none', async () => {
    const user = userEvent.setup();
    renderDialog();

    expect(screen.getByRole('combobox', { name: 'com_ui_tars_kb_level_default' })).toHaveValue(
      '__none__',
    );
    await addFile(user);
    await upload(user);

    expect(sentForm().has('dataSecurityLevelId')).toBe(false);
  });

  it('sends the level chosen', async () => {
    const user = userEvent.setup();
    renderDialog();

    await addFile(user);
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'com_ui_tars_kb_level_default' }),
      '2',
    );
    await upload(user);

    expect(sentForm().get('dataSecurityLevelId')).toBe('2');
  });
});
