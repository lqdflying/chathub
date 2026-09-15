'use client';

import React, { CSSProperties, ReactNode, memo } from 'react';
import { Flexbox } from 'react-layout-kit';

/**
 * Flex items default to min-width: auto (min-content). Antd/lobehub Select is
 * typically width 100% of the row, so a sibling Check button overflows and
 * SettingContainer's overflow-x: hidden clips it.
 *
 * Wrap the Select so it shrinks; keep the button at intrinsic width.
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/min-width
 */
export const CHECKER_SELECT_WRAP_STYLE: CSSProperties = {
  flexBasis: 160,
  flexGrow: 1,
  flexShrink: 1,
  minWidth: 0,
  overflow: 'hidden',
};

export const CHECKER_BUTTON_STYLE: CSSProperties = {
  flexGrow: 0,
  flexShrink: 0,
};

export interface CheckerActionRowProps {
  button: ReactNode;
  select: ReactNode;
}

export const CheckerActionRow = memo<CheckerActionRowProps>(({ button, select }) => (
  <Flexbox
    align={'center'}
    data-testid={'checker-action-row'}
    gap={8}
    horizontal
    style={{ flexWrap: 'wrap', minWidth: 0, width: '100%' }}
    wrap={'wrap'}
  >
    <div data-testid={'checker-select-wrap'} style={CHECKER_SELECT_WRAP_STYLE}>
      {select}
    </div>
    <div data-testid={'checker-button-wrap'} style={CHECKER_BUTTON_STYLE}>
      {button}
    </div>
  </Flexbox>
));

CheckerActionRow.displayName = 'CheckerActionRow';
