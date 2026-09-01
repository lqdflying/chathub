import { Form } from '@lobehub/ui';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfigProvider, Switch } from 'antd';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { attachFormItemTooltipGuard } from '@/components/FormItemTooltipGuard/attach';
import { withTooltip } from '@/components/FormLabelWithTooltip';

vi.stubGlobal('React', React);

vi.mock('antd-style', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd-style')>();
  return {
    ...actual,
    useTheme: () => ({ colorTextTertiary: '#999' }),
  };
});

const switchLabelCss = `
  .ant-form-item:has(.ant-switch) .ant-form-item-label > label {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    cursor: default;
    pointer-events: none;
  }
  .ant-form-item:has(.ant-switch) .ant-form-item-label .ant-form-item-tooltip {
    cursor: help;
    pointer-events: auto;
  }
`;

const SwitchRowHarness = () => (
  <ConfigProvider>
    <Form
      initialValues={{ enableTokenThresholdAutoCompact: true }}
      items={[
        {
          children: <Switch />,
          label: 'Auto-compact',
          layout: 'horizontal',
          minWidth: undefined,
          name: 'enableTokenThresholdAutoCompact',
          tooltip: {
            title: 'Compaction help',
            trigger: ['hover', 'click'],
          },
          valuePropName: 'checked',
        },
      ]}
      itemsType={'flat'}
      variant={'borderless'}
    />
  </ConfigProvider>
);

describe('AgentChat switch-row native tooltips', () => {
  it('opens help on hover/click without changing the switch', async () => {
    const user = userEvent.setup();
    const style = document.createElement('style');
    style.textContent = switchLabelCss;
    document.head.append(style);
    const detachGuard = attachFormItemTooltipGuard();

    const { container } = render(<SwitchRowHarness />);

    const nativeTooltip = container.querySelector('.ant-form-item-tooltip') as HTMLElement;
    expect(nativeTooltip).toBeTruthy();
    expect(getComputedStyle(nativeTooltip).pointerEvents).toBe('auto');

    const switchControl = screen.getByRole('switch');
    expect(switchControl.getAttribute('aria-checked')).toBe('true');

    await user.hover(nativeTooltip);
    await waitFor(() => {
      expect(screen.getByText('Compaction help')).toBeTruthy();
    });
    await user.unhover(nativeTooltip);

    await user.click(nativeTooltip);
    await waitFor(() => {
      expect(screen.getByText('Compaction help')).toBeTruthy();
    });

    expect(switchControl.getAttribute('aria-checked')).toBe('true');
    detachGuard();
    style.remove();
  });
});

describe('FormLabelWithTooltip (non-switch rows)', () => {
  it('renders the label text with an inline help icon', () => {
    const { container } = render(
      <ConfigProvider>{withTooltip('Assist preset', 'Preset help')}</ConfigProvider>,
    );

    expect(container.textContent).toContain('Assist preset');
    expect(container.querySelectorAll('.chathub-form-label-tooltip')).toHaveLength(1);
  });
});
