import React from 'react';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import { ChipModes } from '../Bar';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

describe('ChipModes', () => {
  it('keeps a portaled menu choice from reaching the composer', async () => {
    const user = userEvent.setup();
    const onComposerClick = jest.fn();
    const onSelect = jest.fn();
    render(
      <div onClick={onComposerClick}>
        <ChipModes modes={[{ id: 'high', label: 'High', active: false, onSelect }]} />
      </div>,
    );

    await user.click(screen.getByRole('button', { name: 'com_ui_mode' }));
    onComposerClick.mockClear();
    await user.click(screen.getByRole('menuitemradio', { name: 'High' }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onComposerClick).not.toHaveBeenCalled();
  });

  it('keeps a server with many tools scrollable inside the viewport', async () => {
    const user = userEvent.setup();
    const onSelect = jest.fn();
    const modes = Array.from({ length: 47 }, (_, index) => ({
      id: `tool-${index}`,
      label: `tool_${index}`,
      active: true,
      onSelect,
    }));
    render(<ChipModes modes={modes} multiple />);

    await user.click(screen.getByRole('button', { name: 'com_ui_mode_value' }));
    const menu = screen.getByRole('menu');
    expect(menu.className).toContain('max-h-[min(24rem,var(--popover-available-height,24rem))]');
    expect(menu.className).toContain('overflow-y-auto');

    await user.click(screen.getByRole('menuitemcheckbox', { name: 'tool_46' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it("reads a checklist's own summary in place of the tool count", () => {
    const modes = [
      { id: 'kb_rules', label: '公司規範知識庫', active: true, onSelect: jest.fn() },
      { id: 'kb_env', label: '097內規比對(環安)', active: false, onSelect: jest.fn() },
    ];
    render(<ChipModes modes={modes} multiple summary="1/2 個知識庫" />);

    expect(screen.getByRole('button', { name: 'com_ui_mode_value' })).toHaveTextContent(
      '1/2 個知識庫',
    );
    expect(screen.queryByText('com_ui_tars_mcp_tools_count')).not.toBeInTheDocument();
  });
});
