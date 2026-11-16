/**
 * Guards the pwc_tars display names in the model picker. Upstream files read them at five
 * places (EndpointModelItem, SearchResults, utils' filterItems / filterModels /
 * getDisplayValue), so a rebase that takes upstream's copy of one of them fails here rather
 * than silently showing raw model ids again. Kept apart from upstream's own test files so
 * resolving those cannot drop this guard.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { Endpoint, SelectedValues } from '~/common';
import type { useLocalize } from '~/hooks';
import { filterItems, filterModels, getDisplayValue } from '../utils';
import { EndpointModelItem } from '../components/EndpointModelItem';
import { SearchResults } from '../components/SearchResults';
import { pickModelNames } from '../labels';

const mockHandleSelectModel = jest.fn();
let mockSelectedValues: SelectedValues = { endpoint: '', model: '', modelSpec: '' };

jest.mock('~/components/Chat/Menus/Endpoints/ModelSelectorContext', () => ({
  useModelSelectorContext: () => ({
    selectedValues: mockSelectedValues,
    handleSelectSpec: jest.fn(),
    handleSelectModel: mockHandleSelectModel,
    handleSelectEndpoint: jest.fn(),
    endpointsConfig: {},
  }),
}));

jest.mock('~/components/Chat/Menus/Endpoints/CustomMenu', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    CustomMenuItem: React.forwardRef(function MockMenuItem(
      { children, ...rest }: { children?: React.ReactNode },
      ref: React.Ref<HTMLDivElement>,
    ) {
      return React.createElement('div', { ref, role: 'menuitem', ...rest }, children);
    }),
  };
});

jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }));

jest.mock('~/hooks', () => ({
  useFavorites: () => ({
    isFavoriteModel: () => false,
    toggleFavoriteModel: jest.fn(),
    isFavoriteAgent: () => false,
    toggleFavoriteAgent: jest.fn(),
  }),
  useLocalize: () => (key: string) => key,
}));

jest.mock('~/components/Chat/Menus/Endpoints/useActiveItem', () => ({
  __esModule: true,
  default: () => ({ ref: { current: null }, isActive: false }),
}));

const localize = ((key: string) => key) as ReturnType<typeof useLocalize>;

const openAI: Endpoint = {
  value: 'openAI',
  label: 'OpenAI',
  hasModels: true,
  icon: null,
  models: [{ name: 'gpt-5.4-mini' }, { name: 'o3' }],
  modelNames: { 'gpt-5.4-mini': '快速模型' },
};

beforeEach(() => {
  mockHandleSelectModel.mockClear();
  mockSelectedValues = { endpoint: '', model: '', modelSpec: '' };
});

describe('pickModelNames', () => {
  it('keys the names by the endpoint model name, matched without regard to case', () => {
    const labels = new Map([['gpt-5.4-mini', '快速模型']]);
    expect(pickModelNames([{ name: 'GPT-5.4-mini' }, { name: 'o3' }], labels)).toEqual({
      'GPT-5.4-mini': '快速模型',
    });
  });

  it('gives nothing when no model has a display name or none were loaded', () => {
    expect(pickModelNames([{ name: 'o3' }], new Map([['gpt-5.4-mini', 'x']]))).toBeUndefined();
    expect(pickModelNames([{ name: 'o3' }], new Map())).toBeUndefined();
    expect(pickModelNames([{ name: 'o3' }], undefined)).toBeUndefined();
  });

  it('reads no inherited method for a model named like an Object.prototype key', () => {
    const modelNames = pickModelNames(
      [{ name: 'gpt-5.4-mini' }, { name: 'constructor' }, { name: 'toString' }],
      new Map([['gpt-5.4-mini', '快速模型']]),
    );
    const endpoint: Endpoint = {
      ...openAI,
      models: [{ name: 'gpt-5.4-mini' }, { name: 'constructor' }, { name: 'toString' }],
      modelNames,
    };
    expect(modelNames?.constructor).toBeUndefined();
    expect(
      filterModels(endpoint, ['constructor', 'toString'], 'con', undefined, undefined),
    ).toEqual(['constructor']);
    expect(
      getDisplayValue({
        localize,
        modelSpecs: [],
        mappedEndpoints: [endpoint],
        selectedValues: { endpoint: 'openAI', model: 'toString', modelSpec: '' },
      }),
    ).toBe('toString');
  });
});

describe('model picker search', () => {
  it('finds the endpoint and the model by display name as well as by name', () => {
    expect(filterItems([openAI], '快速', undefined, undefined)).toEqual([openAI]);
    expect(filterModels(openAI, ['gpt-5.4-mini', 'o3'], '快速', undefined, undefined)).toEqual([
      'gpt-5.4-mini',
    ]);
    expect(filterModels(openAI, ['gpt-5.4-mini', 'o3'], 'mini', undefined, undefined)).toEqual([
      'gpt-5.4-mini',
    ]);
  });

  it('lists a search hit by its display name', () => {
    render(<SearchResults results={[openAI]} localize={localize} searchValue="快速" />);
    expect(screen.getByRole('menuitem', { name: /快速模型/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /o3/ })).not.toBeInTheDocument();
  });
});

describe('model picker rows and header', () => {
  it('shows the display name on the row and still selects the model by its name', () => {
    render(
      <EndpointModelItem
        modelId="gpt-5.4-mini"
        endpoint={openAI}
        isFavorite={false}
        onToggleFavorite={jest.fn()}
      />,
    );
    expect(screen.getByText('快速模型')).toBeInTheDocument();
    expect(screen.queryByText('gpt-5.4-mini')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitem'));
    expect(mockHandleSelectModel).toHaveBeenCalledWith(openAI, 'gpt-5.4-mini');
  });

  it('shows the model name on a row without a display name', () => {
    render(
      <EndpointModelItem
        modelId="o3"
        endpoint={openAI}
        isFavorite={false}
        onToggleFavorite={jest.fn()}
      />,
    );
    expect(screen.getByText('o3')).toBeInTheDocument();
  });

  it('heads the selector with the display name, and with the name when there is none', () => {
    const display = (model: string) =>
      getDisplayValue({
        localize,
        modelSpecs: [],
        mappedEndpoints: [openAI],
        selectedValues: { endpoint: 'openAI', model, modelSpec: '' },
      });
    expect(display('gpt-5.4-mini')).toBe('快速模型');
    expect(display('o3')).toBe('o3');
  });
});
