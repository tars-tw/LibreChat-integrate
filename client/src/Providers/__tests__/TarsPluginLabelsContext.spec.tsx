import React from 'react';
import { RecoilRoot } from 'recoil';
import { QueryKeys } from 'librechat-data-provider';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@testing-library/jest-dom/extend-expect';
import { useTarsPluginLabels, TarsPluginLabelsProvider } from '~/Providers/TarsPluginLabelsContext';

function Labels() {
  const labels = useTarsPluginLabels();
  return <span data-testid="labels">{JSON.stringify([...labels])}</span>;
}

const renderWith = (queryClient: QueryClient, enabled: boolean) =>
  render(
    <RecoilRoot>
      <QueryClientProvider client={queryClient}>
        <TarsPluginLabelsProvider enabled={enabled}>
          <Labels />
        </TarsPluginLabelsProvider>
      </QueryClientProvider>
    </RecoilRoot>,
  );

describe('TarsPluginLabelsContext', () => {
  it('maps each listed pwc_tars plugin tool to its display name, other tools left out', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(
      [QueryKeys.tools],
      [
        { name: 'Calculator', pluginKey: 'calculator' },
        { name: 'Python Calculator', pluginKey: 'tars_plugin_python_exec' },
        { name: 'Text Stats', pluginKey: 'tars_plugin_text_stats' },
      ],
    );
    renderWith(queryClient, true);
    expect(screen.getByTestId('labels')).toHaveTextContent(
      JSON.stringify([
        ['tars_plugin_python_exec', 'Python Calculator'],
        ['tars_plugin_text_stats', 'Text Stats'],
      ]),
    );
  });

  it('serves no labels outside the provider', () => {
    render(<Labels />);
    expect(screen.getByTestId('labels')).toHaveTextContent('[]');
  });
});
