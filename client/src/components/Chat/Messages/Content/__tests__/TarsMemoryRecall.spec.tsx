import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import { createStore, Provider } from 'jotai';
import { Tools } from 'librechat-data-provider';
import { fireEvent, render, screen } from '@testing-library/react';
import type { TAttachment, TTarsMemory } from 'librechat-data-provider';
import { showTarsMemoryRecallAtom } from '~/components/SidePanel/Memories/Tars/store';
import TarsMemoryRecall from '../TarsMemoryRecall';

let mockMemories: TTarsMemory[] | undefined;
let mockError = false;
let mockCanRead = true;
const mockQueryOptions = jest.fn();

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: { count?: number }) =>
    values?.count != null ? `${key}:${values.count}` : key,
  useHasAccess: () => mockCanRead,
}));

jest.mock('~/data-provider', () => ({
  useTarsMemoriesQuery: (options: { enabled: boolean }) => {
    mockQueryOptions(options);
    return { data: mockMemories && { memories: mockMemories }, isError: mockError };
  },
}));

const memory = (overrides: Partial<TTarsMemory>): TTarsMemory => ({
  id: '1',
  conversation_id: null,
  memory_type: 'semantic',
  content: '',
  items: null,
  category: null,
  reason: null,
  created_at: null,
  updated_at: null,
  ...overrides,
});

const attachments = [
  { type: Tools.tars_memory, [Tools.tars_memory]: { ids: ['1', '2'], count: 3 } },
] as unknown as TAttachment[];

const open = () => fireEvent.click(screen.getByRole('button'));

const renderShown = (list: TAttachment[] = attachments) => {
  const store = createStore();
  store.set(showTarsMemoryRecallAtom, true);
  return render(
    <Provider store={store}>
      <TarsMemoryRecall attachments={list} />
    </Provider>,
  );
};

describe('TarsMemoryRecall', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.removeItem('showTarsMemoryRecall');
    mockError = false;
    mockCanRead = true;
    mockMemories = [
      memory({ id: '1', memory_type: 'profile', items: ['偏好繁中', '回答簡潔'] }),
      memory({ id: '2', content: '常查品質異常' }),
      memory({ id: '9', content: '這次沒有用到' }),
    ];
  });

  it('stays hidden and reads nothing until the user turns it on', () => {
    const { container } = render(
      <Provider store={createStore()}>
        <TarsMemoryRecall attachments={attachments} />
      </Provider>,
    );
    expect(container).toBeEmptyDOMElement();
    expect(mockQueryOptions).not.toHaveBeenCalled();
  });

  it('stays hidden for a role that cannot read memory, so it never asks for the list', () => {
    mockCanRead = false;
    const { container } = renderShown();
    expect(container).toBeEmptyDOMElement();
    expect(mockQueryOptions).not.toHaveBeenCalled();
  });

  it('renders nothing on a reply that recalled nothing', () => {
    const { container } = renderShown([]);
    expect(container).toBeEmptyDOMElement();
    expect(mockQueryOptions).not.toHaveBeenCalled();
  });

  it('shows the count and reads memory only once opened', () => {
    renderShown();
    expect(screen.getByText('com_ui_tars_memory_recall:3')).toBeInTheDocument();
    expect(mockQueryOptions).toHaveBeenLastCalledWith({ enabled: false });
    expect(screen.queryByText('偏好繁中')).toBeNull();
    open();
    expect(mockQueryOptions).toHaveBeenLastCalledWith({ enabled: true });
  });

  it('lists only the recalled memories, from the current list', () => {
    renderShown();
    open();
    expect(screen.getByText('偏好繁中')).toBeInTheDocument();
    expect(screen.getByText('回答簡潔')).toBeInTheDocument();
    expect(screen.getByText('常查品質異常')).toBeInTheDocument();
    expect(screen.queryByText('這次沒有用到')).toBeNull();
    expect(screen.queryByText('com_ui_tars_memory_recall_missing')).toBeNull();
  });

  it('says so when a recalled memory has since changed or gone', () => {
    mockMemories = [memory({ id: '2', content: '常查品質異常' })];
    renderShown();
    open();
    expect(screen.getByText('com_ui_tars_memory_recall_missing')).toBeInTheDocument();
  });

  it('reports a failed read', () => {
    mockMemories = undefined;
    mockError = true;
    renderShown();
    open();
    expect(screen.getByText('com_ui_tars_memory_error_load')).toBeInTheDocument();
  });
});
