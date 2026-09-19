import { ConfigProvider } from 'antd';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';

import {
  CHECKER_BUTTON_MIN,
  CHECKER_COMPACT_MAX,
  CHECKER_GRID_COLUMNS,
  CHECKER_NARROW_DESKTOP_ROW_PX,
  CHECKER_ROW_GAP_PX,
  CHECKER_SELECT_MIN,
  CheckerActionRow,
  checkerRowMinsFitNarrowDesktop,
} from './checkerActionRow';

describe('CheckerActionRow', () => {
  it('keeps both track floors inside the 768px desktop form row', () => {
    expect(CHECKER_GRID_COLUMNS).toBe(
      `minmax(${CHECKER_SELECT_MIN}, 1fr) minmax(${CHECKER_BUTTON_MIN}, max-content)`,
    );
    expect(CHECKER_COMPACT_MAX).toBe('14rem');
    expect(checkerRowMinsFitNarrowDesktop()).toBe(true);
    expect(
      Number.parseFloat(CHECKER_SELECT_MIN) * 16 +
        Number.parseFloat(CHECKER_BUTTON_MIN) * 16 +
        CHECKER_ROW_GAP_PX,
    ).toBeLessThanOrEqual(CHECKER_NARROW_DESKTOP_ROW_PX);
  });

  it('renders Select and Check slots on the shared row', () => {
    render(
      <ConfigProvider>
        <CheckerActionRow
          button={<button type={'button'}>Проверить</button>}
          select={<div style={{ width: '100%' }}>grok-4.6</div>}
        />
      </ConfigProvider>,
    );

    const row = screen.getByTestId('checker-action-row');
    expect(row.className.length).toBeGreaterThan(0);
    expect(screen.getByTestId('checker-select-wrap').textContent).toBe('grok-4.6');
    expect(screen.getByRole('button', { name: 'Проверить' })).toBeTruthy();
  });
});
