import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';

import { CheckerActionRow } from './checkerActionRow';

describe('CheckerActionRow', () => {
  it('lets the select shrink so the Check button is not pushed out of an overflow-x hidden pane', () => {
    render(
      <CheckerActionRow
        button={<button type={'button'}>Check</button>}
        select={<div style={{ width: '100%' }}>MiniMax-M3</div>}
      />,
    );

    const row = screen.getByTestId('checker-action-row');
    expect(row.style.width).toBe('100%');
    expect(['0', '0px']).toContain(row.style.minWidth);
    expect(row.style.flexWrap).toBe('wrap');

    const selectWrap = screen.getByTestId('checker-select-wrap');
    expect(Number(selectWrap.style.flexGrow)).toBe(1);
    expect(Number(selectWrap.style.flexShrink)).toBe(1);
    expect(['0', '0px']).toContain(selectWrap.style.minWidth);

    const buttonWrap = screen.getByTestId('checker-button-wrap');
    expect(Number(buttonWrap.style.flexGrow)).toBe(0);
    expect(Number(buttonWrap.style.flexShrink)).toBe(0);
    expect(screen.getByRole('button', { name: 'Check' })).toBeTruthy();
  });
});
