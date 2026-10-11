import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import '@testing-library/jest-dom/extend-expect';
import type { SharedWithMeLink } from 'librechat-data-provider';
import SharedWithMeSection from '../SharedWithMeSection';

const mockUseSharedWithMeQuery = jest.fn();
let mockExpanded = true;
const mockSetExpanded = jest.fn((value: boolean) => {
  mockExpanded = value;
});

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${Object.values(values).join('|')}` : key,
  useLocalStorage: () => [mockExpanded, mockSetExpanded],
}));

jest.mock('~/data-provider', () => ({
  useSharedWithMeQuery: (config: unknown) => mockUseSharedWithMeQuery(config),
}));

const link = (index: number, overrides: Partial<SharedWithMeLink> = {}): SharedWithMeLink => ({
  shareId: `share-${index}`,
  title: `Conversation ${index}`,
  sharedBy: `Owner ${index}`,
  ...overrides,
});

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

const renderSection = ({
  path = '/c/new',
  isAuthenticated = true,
}: { path?: string; isAuthenticated?: boolean } = {}) => {
  const toggleNav = jest.fn();
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <SharedWithMeSection toggleNav={toggleNav} isAuthenticated={isAuthenticated} />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  return { toggleNav };
};

describe('SharedWithMeSection', () => {
  beforeEach(() => {
    mockExpanded = true;
    mockSetExpanded.mockClear();
    mockUseSharedWithMeQuery.mockReturnValue({ data: { links: [link(1), link(2)] } });
  });

  it('is hidden while nothing has been shared with the user', () => {
    mockUseSharedWithMeQuery.mockReturnValue({ data: { links: [] } });
    renderSection();
    expect(screen.queryByTestId('shared-with-me-section')).not.toBeInTheDocument();
  });

  it('does not fetch for a signed-out user', () => {
    renderSection({ isAuthenticated: false });
    expect(mockUseSharedWithMeQuery).toHaveBeenCalledWith({ enabled: false });
    expect(screen.queryByTestId('shared-with-me-section')).not.toBeInTheDocument();
  });

  it('lists each conversation with who shared it', () => {
    renderSection();

    const items = screen.getAllByTestId('shared-with-me-item');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveAccessibleName('com_ui_shared_with_me_item:Conversation 1|Owner 1');
    expect(items[0]).toHaveTextContent('Conversation 1');
    expect(items[0]).toHaveTextContent('Owner 1');
  });

  it('opens a conversation inside the app and closes the mobile drawer', () => {
    const { toggleNav } = renderSection();

    fireEvent.click(screen.getAllByTestId('shared-with-me-item')[1]);

    expect(screen.getByTestId('location')).toHaveTextContent('/shared/share-2');
    expect(toggleNav).toHaveBeenCalled();
  });

  it('marks the conversation being viewed as current', () => {
    renderSection({ path: '/shared/share-2' });

    const items = screen.getAllByTestId('shared-with-me-item');
    expect(items[1]).toHaveAttribute('aria-current', 'page');
    expect(items[0]).not.toHaveAttribute('aria-current');
  });

  it('remembers the collapsed state through the header toggle', () => {
    renderSection();

    const header = screen.getByRole('button', { name: 'com_ui_shared_with_me' });
    expect(header).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(header);
    expect(mockSetExpanded).toHaveBeenCalledWith(false);
  });

  it('shows the first ten and expands to all on request', () => {
    mockUseSharedWithMeQuery.mockReturnValue({
      data: { links: Array.from({ length: 12 }, (_, index) => link(index)) },
    });
    renderSection();

    expect(screen.getAllByTestId('shared-with-me-item')).toHaveLength(10);
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_show_all_count:12' }));
    expect(screen.getAllByTestId('shared-with-me-item')).toHaveLength(12);
  });
});
