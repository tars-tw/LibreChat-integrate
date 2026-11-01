import React from 'react';
import userEvent from '@testing-library/user-event';
import { PrincipalType } from 'librechat-data-provider';
import { act, render, screen } from '@testing-library/react';
import type {
  TPrincipal,
  TTarsPrincipalInfo,
  TTarsDataSecurityAssignment,
} from 'librechat-data-provider';
import SecurityTab from '../SecurityTab';

type MutationOptions = { onSuccess?: () => void; onError?: (error: unknown) => void };

const mockSave = jest.fn();
const mockShowToast = jest.fn();
const options: { current?: MutationOptions } = {};

jest.mock('~/data-provider', () => ({
  useSaveTarsKnowledgeBaseSecurityMutation: (_kb: string, opts: MutationOptions) => {
    options.current = opts;
    return { mutate: mockSave, isLoading: false };
  },
}));

jest.mock('@librechat/client', () => ({
  ...jest.requireActual('@librechat/client'),
  useToastContext: () => ({ showToast: mockShowToast }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, params?: Record<string, string>) =>
    params != null ? `${key} ${Object.values(params).join(' ')}` : key,
}));

const mockDirectoryUser = {
  type: PrincipalType.USER,
  id: 'mongo-u9',
  idOnTheSource: 'u9',
  name: 'New',
} as TPrincipal;

/** Stands in for the directory combobox: one press adds the same person. */
jest.mock('~/components/Sharing/PeoplePicker/DirectoryPeoplePicker', () => ({
  __esModule: true,
  default: ({ onAddPeople }: { onAddPeople: (people: TPrincipal[]) => void }) => (
    <button type="button" data-testid="pick" onClick={() => onAddPeople([mockDirectoryUser])} />
  ),
}));

const user = (id: string, name: string, extra: Partial<TTarsPrincipalInfo> = {}) =>
  ({
    principal_type: 'user',
    principal_id: id,
    name,
    email: `${id}@x`,
    is_active: true,
    ...extra,
  }) as TTarsPrincipalInfo;

const group = (id: string, name: string): TTarsPrincipalInfo => ({
  principal_type: 'group',
  principal_id: id,
  name,
  email: null,
  is_active: true,
});

const levels = (): TTarsDataSecurityAssignment[] => [
  {
    id: '1',
    name: '高度機密',
    description: '只有指派對象可看',
    order: 1,
    principals: [group('g1', 'BOSS'), user('u1', 'Amy'), user('u2', 'Old', { is_active: false })],
  },
  { id: '2', name: '機密', description: null, order: 2, principals: [] },
];

const renderTab = (props: Partial<React.ComponentProps<typeof SecurityTab>> = {}) =>
  render(
    <SecurityTab
      knowledgeBaseId="kb-1"
      levels={levels()}
      isLoading={false}
      isError={false}
      {...props}
    />,
  );

beforeEach(() => {
  mockSave.mockClear();
  mockShowToast.mockClear();
});

describe('SecurityTab', () => {
  it('lists each level with its assignees, disabled ones marked', () => {
    renderTab();

    expect(screen.getByText('高度機密')).toBeInTheDocument();
    expect(screen.getByText('只有指派對象可看')).toBeInTheDocument();
    expect(screen.getByText('Amy')).toBeInTheDocument();
    expect(screen.getByText('BOSS')).toBeInTheDocument();
    expect(screen.getByText('com_ui_tars_mcp_disabled')).toBeInTheDocument();
  });

  it('warns that a level nobody is assigned is unreadable', () => {
    renderTab();

    expect(screen.getByText('com_ui_tars_kb_security_empty')).toBeInTheDocument();
  });

  it('filters one level by name or email', async () => {
    const actor = userEvent.setup();
    renderTab();

    await actor.type(screen.getByLabelText('com_ui_tars_kb_security_search'), 'u1@');

    expect(screen.getByText('Amy')).toBeInTheDocument();
    expect(screen.queryByText('BOSS')).not.toBeInTheDocument();
  });

  it('removes one assignee after confirming, keeping everyone else', async () => {
    const actor = userEvent.setup();
    renderTab();

    await actor.click(screen.getByRole('button', { name: 'com_ui_tars_mcp_unassign Amy' }));
    expect(mockSave).not.toHaveBeenCalled();
    await actor.click(screen.getByRole('button', { name: 'com_ui_tars_mcp_unassign' }));

    expect(mockSave).toHaveBeenCalledWith({
      levelId: '1',
      data: {
        principals: [
          { principal_type: 'group', principal_id: 'g1' },
          { principal_type: 'user', principal_id: 'u2' },
        ],
      },
    });
  });

  it('saves the whole list from the assign dialog', async () => {
    const actor = userEvent.setup();
    renderTab();

    const [high] = screen.getAllByRole('button', { name: 'com_ui_tars_kb_security_assign' });
    await actor.click(high);
    await actor.click(screen.getByTestId('pick'));
    await actor.click(screen.getByRole('button', { name: 'com_ui_save' }));

    expect(mockSave).toHaveBeenCalledWith({
      levelId: '1',
      data: {
        principals: [
          { principal_type: 'group', principal_id: 'g1' },
          { principal_type: 'user', principal_id: 'u1' },
          { principal_type: 'user', principal_id: 'u2' },
          { principal_type: 'user', principal_id: 'u9' },
        ],
      },
    });
  });

  it('tells the admin when a save worked', () => {
    renderTab();

    act(() => options.current?.onSuccess?.());

    expect(mockShowToast).toHaveBeenCalledWith({
      message: 'com_ui_tars_kb_security_saved 機密',
      status: 'success',
    });
  });

  it('says so when the levels cannot load', () => {
    renderTab({ levels: [], isError: true });

    expect(screen.getByText('com_ui_tars_kb_security_load_failed')).toBeInTheDocument();
  });
});
