'use client';

import React, { CSSProperties, ReactNode, memo } from 'react';

/**
 * Keep model Select and Check on one row. A column Flexbox (react-layout-kit
 * default) puts Check on the next line. A naive horizontal flex / `1fr auto`
 * grid still blows out: Select min-content is the model id, `1fr` is
 * `minmax(auto, 1fr)`, and SettingContainer `overflow-x: hidden` then clips
 * Check (canary.8). `minmax(0, 1fr)` lets the select shrink; Check stays
 * `auto` and visible.
 *
 * @see https://www.w3.org/TR/css-grid-1/#valdef-grid-template-columns-flex
 * @see https://www.w3.org/TR/css-flexbox-1/#min-size-auto
 * @see https://css-tricks.com/preventing-a-grid-blowout/
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/minmax
 * @see https://ant.design/components/select
 */
export const CHECKER_ROW_STYLE: CSSProperties = {
  alignItems: 'center',
  display: 'grid',
  gap: 8,
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  maxWidth: '100%',
  minWidth: 0,
  width: '100%',
};

export const CHECKER_SELECT_WRAP_STYLE: CSSProperties = {
  maxWidth: '100%',
  minWidth: 0,
  overflow: 'hidden',
  width: '100%',
};

export const CHECKER_BUTTON_STYLE: CSSProperties = {
  justifySelf: 'end',
  whiteSpace: 'nowrap',
};

export interface CheckerActionRowProps {
  button: ReactNode;
  select: ReactNode;
}

export const CheckerActionRow = memo<CheckerActionRowProps>(({ button, select }) => (
  <div data-testid={'checker-action-row'} style={CHECKER_ROW_STYLE}>
    <div data-testid={'checker-select-wrap'} style={CHECKER_SELECT_WRAP_STYLE}>
      {select}
    </div>
    <div data-testid={'checker-button-wrap'} style={CHECKER_BUTTON_STYLE}>
      {button}
    </div>
  </div>
));

CheckerActionRow.displayName = 'CheckerActionRow';
