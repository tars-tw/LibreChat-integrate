import React from 'react';
import '@testing-library/jest-dom/extend-expect';
import { render, screen, fireEvent } from '@testing-library/react';
import Command from '../Command';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

const renderCommand = (props: React.ComponentProps<typeof Command> = {}) => {
  const onValueChange = jest.fn();
  render(<Command onValueChange={onValueChange} {...props} />);
  return { input: screen.getByRole('textbox') as HTMLInputElement, onValueChange };
};

describe('Command', () => {
  it('keeps only lowercase ASCII, digits and hyphens by default', () => {
    const { input, onValueChange } = renderCommand();

    fireEvent.change(input, { target: { value: '總結 Report_1' } });

    expect(input).toHaveValue('-report1');
    expect(onValueChange).toHaveBeenLastCalledWith('-report1');
  });

  it('keeps letters of any script when allowUnicode is set', () => {
    const { input, onValueChange } = renderCommand({ allowUnicode: true });

    fireEvent.change(input, { target: { value: '快速 總結，ABC!' } });

    expect(input).toHaveValue('快速-總結abc');
    expect(onValueChange).toHaveBeenLastCalledWith('快速-總結abc');
  });

  it('shows IME text while composing and commits it when composition ends', () => {
    const { input, onValueChange } = renderCommand({ allowUnicode: true });

    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: 'ㄗㄨㄥˇ' } });

    expect(input).toHaveValue('ㄗㄨㄥˇ');
    expect(onValueChange).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '總結' } });
    fireEvent.compositionEnd(input);

    expect(input).toHaveValue('總結');
    expect(onValueChange).toHaveBeenLastCalledWith('總結');
  });

  it('shows the stored command it is given', () => {
    const { input } = renderCommand({ initialValue: '翻譯', allowUnicode: true });

    expect(input).toHaveValue('翻譯');
  });
});
