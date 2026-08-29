import { Form } from '@lobehub/ui';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfigProvider, Switch } from 'antd';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

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
    cursor: default;
    pointer-events: none;
  }
  .ant-form-item:has(.ant-switch) .ant-form-item-label .chathub-form-label-tooltip {
    cursor: help;
    pointer-events: auto;
  }
`;

const Harness = () => (
  <ConfigProvider>
    <Form
      initialValues={{ enableTokenThresholdAutoCompact: true }}
      items={[
        {
          children: <Switch />,
          label: withTooltip('Auto-compact', 'Compaction help'),
          layout: 'horizontal',
          minWidth: undefined,
          name: 'enableTokenThresholdAutoCompact',
          valuePropName: 'checked',
        },
      ]}
      itemsType={'flat'}
      variant={'borderless'}
    />
  </ConfigProvider>
);

const renderSwitchRowWithInlineHelp = () => {
  const style = document.createElement('style');
  style.textContent = switchLabelCss;
  document.head.append(style);

  return render(<Harness />);
};

describe('FormLabelWithTooltip on switch rows', () => {
  it('stays interactive under switch-label pointer-events rules', async () => {
    const user = userEvent.setup();
    const { container } = renderSwitchRowWithInlineHelp();

    const helpTrigger = container.querySelector('.chathub-form-label-tooltip') as HTMLElement;
    expect(helpTrigger).toBeTruthy();
    expect(getComputedStyle(helpTrigger).pointerEvents).toBe('auto');

    const switchControl = screen.getByRole('switch');
    expect(switchControl.getAttribute('aria-checked')).toBe('true');

    await user.hover(helpTrigger);
    await waitFor(() => {
      expect(screen.getByText('Compaction help')).toBeTruthy();
    });
    await user.unhover(helpTrigger);

    await user.click(helpTrigger);
    await waitFor(() => {
      expect(screen.getByText('Compaction help')).toBeTruthy();
    });

    expect(switchControl.getAttribute('aria-checked')).toBe('true');
  });
});
