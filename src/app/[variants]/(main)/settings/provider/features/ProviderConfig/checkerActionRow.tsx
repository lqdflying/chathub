'use client';

import { createStyles } from 'antd-style';
import React, { ReactNode, memo } from 'react';

/**
 * Keep model Select and Check on one row without collapsing either control.
 * `minmax(0, 1fr) auto` let a long translation (`Проверить`) plus the 8px gap
 * consume a 112px 768px-desktop form row, so the select became 0px. Both
 * tracks now have floors that still fit that row (`4rem + 2rem + 8px = 104px`
 * at a 16px root). Below `14rem` the Check label is visually hidden and an
 * icon (or the loading spinner) remains; `aria-label` keeps the full name.
 *
 * @see https://www.w3.org/TR/css-grid-1/#valdef-grid-template-columns-flex
 * @see https://www.w3.org/TR/css-flexbox-1/#min-size-auto
 * @see https://developer.mozilla.org/en-US/docs/Web/CSS/container-type
 * @see https://www.w3.org/WAI/WCAG22/Techniques/css/C7
 * @see https://css-tricks.com/preventing-a-grid-blowout/
 * @see https://ant.design/components/button
 */
export const CHECKER_SELECT_MIN = '4rem';
export const CHECKER_BUTTON_MIN = '2rem';
export const CHECKER_ROW_GAP_PX = 8;
export const CHECKER_NARROW_DESKTOP_ROW_PX = 112;
export const CHECKER_COMPACT_MAX = '14rem';
export const CHECKER_GRID_COLUMNS = `minmax(${CHECKER_SELECT_MIN}, 1fr) minmax(${CHECKER_BUTTON_MIN}, max-content)`;
export const CHECKER_BUTTON_LABEL_ATTR = 'data-checker-button-label';
export const CHECKER_BUTTON_ICON_ATTR = 'data-checker-button-icon';

export const checkerRowMinsFitNarrowDesktop = (rootPx = 16) =>
  Number.parseFloat(CHECKER_SELECT_MIN) * rootPx +
    Number.parseFloat(CHECKER_BUTTON_MIN) * rootPx +
    CHECKER_ROW_GAP_PX <=
  CHECKER_NARROW_DESKTOP_ROW_PX;

const useStyles = createStyles(({ css, prefixCls }) => ({
  buttonWrap: css`
    justify-self: end;
    min-width: 0;
    max-width: 100%;

    button {
      overflow: hidden;
      max-width: 100%;
    }
  `,
  row: css`
    container-type: inline-size;
    display: grid;
    grid-template-columns: ${CHECKER_GRID_COLUMNS};
    gap: ${CHECKER_ROW_GAP_PX}px;
    align-items: center;

    width: 100%;
    min-width: 0;
    max-width: 100%;

    [${CHECKER_BUTTON_ICON_ATTR}] {
      display: none;
    }

    .${prefixCls}-btn-loading [${CHECKER_BUTTON_ICON_ATTR}] {
      display: none !important;
    }

    @container (max-width: ${CHECKER_COMPACT_MAX}) {
      [${CHECKER_BUTTON_ICON_ATTR}] {
        display: inline-flex;
      }

      [${CHECKER_BUTTON_LABEL_ATTR}] {
        position: absolute;

        overflow: hidden;

        width: 1px;
        height: 1px;

        white-space: nowrap;

        clip: rect(1px, 1px, 1px, 1px);
        clip-path: inset(100%);
      }
    }
  `,
  selectWrap: css`
    overflow: hidden;
    width: 100%;
    min-width: 0;
    max-width: 100%;
  `,
}));

export interface CheckerActionRowProps {
  button: ReactNode;
  select: ReactNode;
}

export const CheckerActionRow = memo<CheckerActionRowProps>(({ button, select }) => {
  const { styles } = useStyles();

  return (
    <div className={styles.row} data-testid={'checker-action-row'}>
      <div className={styles.selectWrap} data-testid={'checker-select-wrap'}>
        {select}
      </div>
      <div className={styles.buttonWrap} data-testid={'checker-button-wrap'}>
        {button}
      </div>
    </div>
  );
});

CheckerActionRow.displayName = 'CheckerActionRow';
