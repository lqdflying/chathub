import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';

import { CheckerActionRow } from './checkerActionRow';

describe('CheckerActionRow', () => {
  it('stacks the select above Check so overflow-x hidden cannot clip the button', () => {
    render(
      <CheckerActionRow
        button={<button type={'button'}>Check</button>}
        select={<div style={{ width: '100%' }}>MiniMax-M3</div>}
      />,
    );

    const row = screen.getByTestId('checker-action-row');
    expect(row.style.width).toBe('100%');
    expect(row.style.maxWidth).toBe('100%');
    expect(['0', '0px']).toContain(row.style.minWidth);
    expect(row.style.flexDirection === '' || row.style.flexDirection === 'column').toBe(true);

    const selectWrap = screen.getByTestId('checker-select-wrap');
    expect(selectWrap.style.width).toBe('100%');
    expect(selectWrap.style.maxWidth).toBe('100%');
    expect(['0', '0px']).toContain(selectWrap.style.minWidth);

    expect(screen.getByRole('button', { name: 'Check' })).toBeTruthy();
  });
});
