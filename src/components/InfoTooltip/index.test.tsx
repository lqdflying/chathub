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
  it('opens on hover and on click', async () => {
    const user = userEvent.setup();

    render(
      <ConfigProvider>
        <InfoTooltip title="Compaction help" />
      </ConfigProvider>,
    );

    const trigger = screen.getByRole('img', { hidden: true }).parentElement!;

    await user.hover(trigger);
    await waitFor(() => {
      expect(screen.getByText('Compaction help')).toBeTruthy();
    });
    await user.unhover(trigger);

    await user.click(trigger);
    await waitFor(() => {
      expect(screen.getByText('Compaction help')).toBeTruthy();
    });
  });
});
