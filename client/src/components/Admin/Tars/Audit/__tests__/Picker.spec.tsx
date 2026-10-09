import React from 'react';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import Picker from '../Picker';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, options?: Record<string, string>) =>
    options ? `${key}:${Object.values(options).join(',')}` : key,
}));

const options = [
  { value: 'u-1', label: 'Amy' },
  { value: 'u-2', label: 'Ben' },
  { value: 'u-3', label: 'Cara' },
];

const renderPicker = (selected: string[], chips = true) => {
  const onChange = jest.fn();
  render(
    <Picker
      id="picker"
      label="Users"
      options={options}
      selected={selected}
      onChange={onChange}
      placeholder="Select users"
      chips={chips}
    />,
  );
  return onChange;
};

describe('Picker chips', () => {
  it('names every pick instead of counting them', () => {
    renderPicker(['u-1', 'u-3']);
    expect(screen.getByText('Amy')).toBeInTheDocument();
    expect(screen.getByText('Cara')).toBeInTheDocument();
    expect(screen.queryByText('com_ui_tars_audit_selected_count:2')).not.toBeInTheDocument();
  });

  it('removes one pick without opening the list', async () => {
    const user = userEvent.setup();
    const onChange = renderPicker(['u-1', 'u-3']);
    await user.click(screen.getByRole('button', { name: 'com_ui_tars_audit_remove_option:Amy' }));
    expect(onChange).toHaveBeenCalledWith(['u-3']);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('can be cleared', async () => {
    const user = userEvent.setup();
    const onChange = renderPicker(['u-2']);
    await user.click(screen.getByRole('button', { name: 'com_ui_clear' }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('shows the placeholder when nothing is picked', () => {
    renderPicker([]);
    expect(screen.getByText('Select users')).toBeInTheDocument();
  });

  it('keeps a pick whose option is gone, so it can still be removed', () => {
    renderPicker(['u-9']);
    expect(screen.getByText('u-9')).toBeInTheDocument();
  });

  it('leaves the summary mode as a count', () => {
    renderPicker(['u-1', 'u-3'], false);
    expect(screen.getByText('com_ui_tars_audit_selected_count:2')).toBeInTheDocument();
    expect(screen.queryByText('Amy')).not.toBeInTheDocument();
  });
});
