'use client';

import React, { CSSProperties, ReactNode, memo } from 'react';
import { Flexbox } from 'react-layout-kit';

/**
 * Do not put Select and Check on one horizontal flex row. The select's
 * min-content width plus the button overflows SettingContainer overflow-x
 * hidden and clips Check (canary.8 OpenAI screenshot). Stack them so Check
 * stays in the pane.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/min-width
 * @see https://stackoverflow.com/questions/36230944/prevent-flex-items-from-overflowing-a-container
 */
export const CHECKER_SELECT_WRAP_STYLE: CSSProperties = {
  maxWidth: '100%',
  minWidth: 0,
  width: '100%',
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
    data-testid={'checker-action-row'}
    gap={8}
    style={{ maxWidth: '100%', minWidth: 0, width: '100%' }}
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
