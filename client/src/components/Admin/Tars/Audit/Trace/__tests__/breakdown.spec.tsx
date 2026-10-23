import React from 'react';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import { breakdownShares, formatBreakdownText } from '../breakdown';
import zh from '~/locales/zh-Hant/translation.json';
import en from '~/locales/en/translation.json';
import BreakdownMeter from '../Meter';

/** A shipped catalog with i18next's `{{name}}` interpolation, so the text is the real string. */
const localizeFrom =
  (catalog: Record<string, string>) => (key: string, options?: Record<string, string | number>) =>
    (catalog[key] ?? key).replace(/{{(\w+)}}/g, (_, name: string) => String(options?.[name] ?? ''));
const tEn = localizeFrom(en);
const tZh = localizeFrom(zh);

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

describe('breakdownShares', () => {
  it('has nothing to show without a model share', () => {
    expect(breakdownShares({ modelPercent: null, toolSuccessPercent: 40 })).toEqual([]);
  });

  it('splits tools by outcome only when both outcomes occurred', () => {
    const shares = breakdownShares({
      modelPercent: 60,
      toolSuccessPercent: 10,
      toolFailPercent: 20,
      otherPercent: 10,
    });
    expect(shares.map(({ key, percent, labelKey }) => [key, percent, labelKey])).toEqual([
      ['model', 60, 'com_ui_tars_audit_trace_model_label'],
      ['toolSuccess', 10, 'com_ui_tars_audit_trace_success_tool'],
      ['toolFail', 20, 'com_ui_tars_audit_trace_fail_tool'],
      ['other', 10, 'com_ui_tars_audit_trace_overhead'],
    ]);
  });

  it('names a run whose tools all succeeded plain tools', () => {
    const [, tools] = breakdownShares({ modelPercent: 70, toolSuccessPercent: 30 });
    expect(tools).toMatchObject({
      key: 'toolSuccess',
      labelKey: 'com_ui_tars_audit_trace_tool_label',
      descKey: 'com_ui_tars_audit_trace_breakdown_desc_tool',
    });
  });

  it('keeps a run whose tools all failed as failed tools', () => {
    expect(
      breakdownShares({ modelPercent: 70, toolFailPercent: 30 }).map((share) => share.key),
    ).toEqual(['model', 'toolFail']);
  });

  it('drops an "other" share that is only rounding noise', () => {
    expect(
      breakdownShares({ modelPercent: 99.4, otherPercent: 0.6 }).map((share) => share.key),
    ).toEqual(['model']);
  });
});

describe('formatBreakdownText', () => {
  const shares = breakdownShares({ modelPercent: 60, toolSuccessPercent: 30, otherPercent: 10 });

  it('lists each share with the locale’s own separator', () => {
    expect(formatBreakdownText(shares, tEn)).toBe('Model 60%, Tool 30%, Other 10%');
    expect(formatBreakdownText(shares, tZh)).toBe('模型 60%、工具 30%、其他 10%');
  });

  it('is empty when there is nothing to show', () => {
    expect(formatBreakdownText([], tEn)).toBe('');
  });
});

describe('BreakdownMeter', () => {
  it('draws one segment per share, sized by its percent', () => {
    render(
      <BreakdownMeter
        summary={{
          modelPercent: 60,
          toolSuccessPercent: 10,
          toolFailPercent: 20,
          otherPercent: 10,
        }}
      />,
    );
    const bar = screen.getByRole('img');
    const widths = Array.from(bar.firstElementChild?.children ?? []).map(
      (segment) => (segment as HTMLElement).style.width,
    );
    expect(widths).toEqual(['60%', '10%', '20%', '10%']);
  });

  it('names each share, its time and what it covers on hover', async () => {
    render(
      <BreakdownMeter
        summary={{
          modelPercent: 95,
          modelDurationMs: 3500,
          toolSuccessPercent: 5,
          toolSuccessWaitMs: 150,
        }}
      />,
    );
    await userEvent.hover(screen.getByRole('img'));
    const items = await screen.findAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('com_ui_tars_audit_trace_breakdown_desc_model'),
      expect.stringContaining('com_ui_tars_audit_trace_breakdown_desc_tool'),
    ]);
    expect(items[0]).toHaveTextContent('com_ui_tars_audit_trace_model_label 95%');
    expect(items[0]).toHaveTextContent('com_ui_tars_audit_trace_duration_note');
  });

  it('renders nothing without a model share', () => {
    const { container } = render(<BreakdownMeter summary={{ modelPercent: null }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
