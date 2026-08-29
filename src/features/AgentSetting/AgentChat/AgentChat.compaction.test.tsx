import { render } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('React', React);

vi.mock('antd-style', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd-style')>();
  return {
    ...actual,
    useTheme: () => ({ colorTextTertiary: '#999' }),
  };
});

import { withTooltip } from '@/components/FormLabelWithTooltip';

describe('FormLabelWithTooltip', () => {
  it('renders the label text with an inline help icon', () => {
    const { container } = render(
      <ConfigProvider>{withTooltip('Auto-compact', 'Compaction help')}</ConfigProvider>,
    );

    expect(container.textContent).toContain('Auto-compact');
    expect(container.querySelectorAll('.chathub-form-label-tooltip')).toHaveLength(1);
  });
});
