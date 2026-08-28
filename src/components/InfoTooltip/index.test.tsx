import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

import InfoTooltip from './index';

describe('InfoTooltip', () => {
  it('opens on click without activating the associated switch', async () => {
    const user = userEvent.setup();

    render(
      <ConfigProvider>
        <label htmlFor="setting-switch">
          Auto compact
          <InfoTooltip title="Compaction help" trigger="click" />
        </label>
        <input data-testid="setting-switch" id="setting-switch" type="checkbox" />
      </ConfigProvider>,
    );

    await user.click(screen.getByRole('img', { hidden: true }).parentElement!);

    await waitFor(() => {
      expect(screen.getByText('Compaction help')).toBeTruthy();
    });
    expect((screen.getByTestId('setting-switch') as HTMLInputElement).checked).toBe(false);
  });
});
