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
});
