import React from 'react';
import { createStore, Provider } from 'jotai';
import { FileSources } from 'librechat-data-provider';
import { render, screen, fireEvent } from '@testing-library/react';
import type { TFile } from 'librechat-data-provider';
import type { ExtendedFile } from '~/common';
import { filesDialogTriggerAtom, showFilesDialogAtom } from '~/store/filesDialog';
import { columns } from '../PanelColumns';
import DataTable from '../PanelTable';

const mockAttach = jest.fn();
const mockUseAttachExisting = jest.fn((_context: unknown) => mockAttach);
const mockUseAttachTarget = jest.fn((_conversation: unknown, _disableInputs: boolean) => ({
  endpointType: 'openAI',
  endpointFileConfig: { fileLimit: 10 },
  canAttach: true,
}));

const mockFiles: Map<string, ExtendedFile> = new Map();
const mockSetFiles = jest.fn();
const mockConversation = { conversationId: 'convo-1', endpoint: 'agents' };

jest.mock('@librechat/client', () => ({
  Table: ({ children, ...props }: { children: React.ReactNode }) => (
    <table {...props}>{children}</table>
  ),
  Button: jest
    .requireActual<typeof React>('react')
    .forwardRef<
      HTMLButtonElement,
      { children: React.ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>
    >(({ children, ...props }, ref) => (
      <button ref={ref} {...props}>
        {children}
      </button>
    )),
  TableRow: ({ children, ...props }: { children: React.ReactNode }) => (
    <tr {...props}>{children}</tr>
  ),
  TableHead: ({ children, ...props }: { children: React.ReactNode }) => (
    <th {...props}>{children}</th>
  ),
  TableBody: ({ children, ...props }: { children: React.ReactNode }) => (
    <tbody {...props}>{children}</tbody>
  ),
  TableCell: ({
    children,
    ...props
  }: { children: React.ReactNode } & React.TdHTMLAttributes<HTMLTableCellElement>) => (
    <td {...props}>{children}</td>
  ),
  FilterInput: () => <input data-testid="filter" />,
  TableHeader: ({ children, ...props }: { children: React.ReactNode }) => (
    <thead {...props}>{children}</thead>
  ),
}));

jest.mock('~/Providers', () => ({
  useChatContext: () => ({
    files: mockFiles,
    setFiles: mockSetFiles,
    conversation: mockConversation,
  }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('~/hooks/Files/useAttachExisting', () => ({
  __esModule: true,
  default: (context: unknown) => mockUseAttachExisting(context),
}));

jest.mock('~/hooks/Input/useAttachTarget', () => ({
  __esModule: true,
  default: (conversation: unknown, disableInputs: boolean) =>
    mockUseAttachTarget(conversation, disableInputs),
}));

jest.mock('../PanelFileCell', () => ({ row }: { row: { original: TFile } }) => (
  <span>{row.original?.filename}</span>
));

function makeFile(overrides: Partial<TFile> = {}): TFile {
  return {
    user: 'user-1',
    file_id: 'file-1',
    bytes: 1024,
    embedded: false,
    filename: 'test.pdf',
    filepath: '/files/test.pdf',
    object: 'file',
    type: 'application/pdf',
    usage: 0,
    source: FileSources.local,
    ...overrides,
  };
}

function renderTable(data: TFile[], store = createStore()) {
  render(
    <Provider store={store}>
      <DataTable columns={columns} data={data} />
    </Provider>,
  );
  return store;
}

function getFilenameCell(name: string) {
  const cell = screen.getByText(name).closest('td');
  if (!cell) {
    throw new Error(`No filename cell for ${name}`);
  }
  return cell;
}

describe('Side panel files table', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('attaches through the shared hook with the resolved upload target', () => {
    const file = makeFile();
    renderTable([file]);

    expect(mockUseAttachTarget).toHaveBeenCalledWith(mockConversation, false);
    expect(mockUseAttachExisting).toHaveBeenCalledWith({
      files: mockFiles,
      setFiles: mockSetFiles,
      conversation: mockConversation,
      endpoint: 'agents',
      endpointType: 'openAI',
      endpointFileConfig: { fileLimit: 10 },
    });

    fireEvent.click(getFilenameCell('test.pdf'));
    expect(mockAttach).toHaveBeenCalledTimes(1);
    expect(mockAttach).toHaveBeenCalledWith(file);
  });

  it('attaches from the keyboard', () => {
    const file = makeFile({ file_id: 'file-2', filename: 'notes.txt' });
    renderTable([file]);

    fireEvent.keyDown(getFilenameCell('notes.txt'), { key: 'Enter' });
    expect(mockAttach).toHaveBeenCalledWith(file);
  });

  it('shows the empty state without attaching anything', () => {
    renderTable([]);

    expect(screen.getByText('com_files_no_results')).toBeInTheDocument();
    expect(mockAttach).not.toHaveBeenCalled();
  });

  it('opens the shell file manager with the button as its focus target', () => {
    const store = renderTable([makeFile()]);

    const button = screen.getByRole('button', { name: 'com_sidepanel_manage_files' });
    fireEvent.click(button);

    expect(store.get(showFilesDialogAtom)).toBe(true);
    expect(store.get(filesDialogTriggerAtom)?.current).toBe(button);
    expect(mockAttach).not.toHaveBeenCalled();
  });
});
