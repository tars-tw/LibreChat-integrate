import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { Checkbox, CheckboxGlyph } from './Checkbox';

describe('Checkbox', () => {
  it('reads its corner and unchecked fill from the checkbox roles', () => {
    render(<Checkbox aria-label="Probe" />);

    const box = screen.getByRole('checkbox', { name: 'Probe' });
    expect(box).toHaveClass(
      'rounded-theme-checkbox',
      'theme-checkbox-fill:bg-checkbox-fill',
      'data-[state=checked]:bg-surface-inverted',
    );
    expect(box).not.toHaveClass('rounded-sm');
  });

  it("lets a caller's corner replace the checkbox role", () => {
    render(<Checkbox aria-label="Probe" className="rounded-full" />);

    const box = screen.getByRole('checkbox', { name: 'Probe' });
    expect(box).toHaveClass('rounded-full');
    expect(box).not.toHaveClass('rounded-theme-checkbox');
  });
});

describe('CheckboxGlyph', () => {
  it('paints the unchecked fill role only while unchecked', () => {
    const { container, rerender } = render(<CheckboxGlyph checked={false} />);
    const glyph = container.firstElementChild;

    expect(glyph).toHaveClass('rounded-theme-checkbox', 'theme-checkbox-fill:bg-checkbox-fill');
    expect(glyph).not.toHaveClass('bg-surface-inverted');

    rerender(<CheckboxGlyph checked />);

    expect(glyph).toHaveClass('rounded-theme-checkbox', 'bg-surface-inverted');
    expect(glyph).not.toHaveClass('theme-checkbox-fill:bg-checkbox-fill');
  });
});
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { Checkbox } from './Checkbox';

describe('Checkbox', () => {
  it('shows a check when checked', () => {
    render(<Checkbox aria-label="All" checked={true} />);

    const box = screen.getByRole('checkbox', { name: 'All' });
    expect(box).toHaveAttribute('aria-checked', 'true');
    expect(box.querySelector('.lucide-check')).not.toBeNull();
    expect(box.querySelector('.lucide-minus')).toBeNull();
  });

  it('shows a dash, styled like checked, when only some children are selected', () => {
    render(<Checkbox aria-label="Some" checked="indeterminate" />);

    const box = screen.getByRole('checkbox', { name: 'Some' });
    expect(box).toHaveAttribute('aria-checked', 'mixed');
    expect(box).toHaveAttribute('data-state', 'indeterminate');
    expect(box).toHaveClass('data-[state=indeterminate]:bg-surface-submit');
    expect(box.querySelector('.lucide-minus')).not.toBeNull();
    expect(box.querySelector('.lucide-check')).toBeNull();
  });

  it('shows nothing when unchecked', () => {
    render(<Checkbox aria-label="None" checked={false} />);

    const box = screen.getByRole('checkbox', { name: 'None' });
    expect(box).toHaveAttribute('aria-checked', 'false');
    expect(box.querySelector('svg')).toBeNull();
  });
});
