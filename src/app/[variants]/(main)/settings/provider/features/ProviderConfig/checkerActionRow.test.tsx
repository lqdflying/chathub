import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';

import { CheckerActionRow } from './checkerActionRow';

describe('CheckerActionRow', () => {
  it('keeps Select and Check on one shrinking grid row', () => {
    render(
      <CheckerActionRow
        button={<button type={'button'}>Check</button>}
        select={<div style={{ width: '100%' }}>gpt-5.6-terra</div>}
      />,
    );

    const row = screen.getByTestId('checker-action-row');
    expect(row.style.display).toBe('grid');
    expect(row.style.gridTemplateColumns).toBe('minmax(0, 1fr) auto');
    expect(row.style.width).toBe('100%');
    expect(row.style.maxWidth).toBe('100%');
    expect(['0', '0px']).toContain(row.style.minWidth);
    expect(row.style.flexDirection).toBe('');

    const selectWrap = screen.getByTestId('checker-select-wrap');
    expect(selectWrap.style.width).toBe('100%');
    expect(selectWrap.style.maxWidth).toBe('100%');
    expect(['0', '0px']).toContain(selectWrap.style.minWidth);
    expect(selectWrap.style.overflow).toBe('hidden');

    const buttonWrap = screen.getByTestId('checker-button-wrap');
    expect(buttonWrap.style.whiteSpace).toBe('nowrap');
    expect(screen.getByRole('button', { name: 'Check' })).toBeTruthy();
  });
});
