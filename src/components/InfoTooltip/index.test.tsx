import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import InfoTooltip from './index';

vi.stubGlobal('React', React);

vi.mock('@lobehub/ui', () => ({
  Icon: ({ className }: { className?: string }) => <span data-testid="help-icon" className={className} />,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('antd-style', () => ({
  useTheme: () => ({ colorTextTertiary: '#999' }),
}));

describe('InfoTooltip', () => {
  it('does not activate the associated switch when the help icon is clicked', () => {
    render(
      <>
        <label htmlFor="setting-switch">
          Auto compact
          <InfoTooltip title="Compaction help" />
        </label>
        <input data-testid="setting-switch" id="setting-switch" type="checkbox" />
      </>,
    );

    const helpTrigger = screen.getByTestId('help-icon').parentElement!;
    fireEvent.click(helpTrigger);

    expect((screen.getByTestId('setting-switch') as HTMLInputElement).checked).toBe(false);
  });
});
