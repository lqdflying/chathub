'use client';

import { createStyles } from 'antd-style';
import React, { type CSSProperties, useRef } from 'react';

/**
 * Equal-width Chat Completions | Responses API control.
 *
 * Do not use antd Radio.Group `block` or Segmented `block` here. Both start as
 * content-sized / inline-block, then CSS-in-JS injects flex ~1s after a hard
 * refresh; the selected thumb or item becomes the full pane and the other
 * label is clipped by SettingContainer overflow-x hidden.
 *
 * Layout is inline so LobeHub Form's late `flex: 0` / `width: auto` on
 * `.ant-form-item-control` cannot collapse `minmax(0, 1fr)` inside the
 * field. Equal pills still overflow the viewport when an ancestor flex
 * item keeps `min-width: auto` — DesktopSettingsLayout must set 0.
 *
 * Keyboard follows the WAI-ARIA radio group pattern (roving tabindex,
 * arrows move and check, wrap). Roles alone do not add that behavior.
 *
 * @see https://www.w3.org/WAI/ARIA/apg/patterns/radio/
 * @see https://www.w3.org/TR/css-grid-1/#min-size-auto
 * @see https://ant.design/components/form
 * @see https://ant.design/components/segmented
 * @see https://ant.design/docs/blog/css-in-js
 */
export type ProviderRouteToggleValue = 'chatCompletions' | 'responses';

export type ProviderRouteToggleOption = {
  label: string;
  value: ProviderRouteToggleValue;
};

export interface ProviderRouteToggleProps {
  disabled?: boolean;
  onChange?: (value: ProviderRouteToggleValue) => void;
  options: ProviderRouteToggleOption[];
  value?: ProviderRouteToggleValue;
}

/** Beats hashed CSS-in-JS for the two-column track. */
export const PROVIDER_ROUTE_TOGGLE_TRACK_STYLE: CSSProperties = {
  boxSizing: 'border-box',
  display: 'grid',
  gap: 2,
  gridAutoFlow: 'column',
  gridTemplateColumns: '1fr 1fr',
  maxWidth: '100%',
  minWidth: 0,
  padding: 2,
  width: '100%',
};

export const PROVIDER_ROUTE_TOGGLE_ITEM_STYLE: CSSProperties = {
  boxSizing: 'border-box',
  cursor: 'pointer',
  margin: 0,
  maxWidth: '100%',
  minWidth: 0,
  overflow: 'hidden',
  paddingBlock: 4,
  paddingInline: 8,
  textAlign: 'center',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  width: '100%',
};

const useStyles = createStyles(({ css, token }) => ({
  item: css`
    border: 0;
    border-radius: ${token.borderRadius}px;
    background: transparent;
    color: ${token.colorTextSecondary};
    font: inherit;
    line-height: 22px;

    &:disabled {
      cursor: not-allowed;
      opacity: 0.6;
    }
  `,
  itemActive: css`
    background: ${token.colorBgContainer};
    color: ${token.colorText};
    box-shadow: ${token.boxShadowTertiary};
  `,
  track: css`
    border-radius: ${token.borderRadiusLG}px;
    background: ${token.colorFillTertiary};
  `,
}));

const ProviderRouteToggle = ({ disabled, onChange, options, value }: ProviderRouteToggleProps) => {
  const { cx, styles } = useStyles();
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectIndex = (index: number) => {
    const option = options[index];
    if (!option || disabled) return;
    onChange?.(option.value);
    buttonRefs.current[index]?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (disabled) return;
    const last = options.length - 1;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown': {
        event.preventDefault();
        selectIndex(index === last ? 0 : index + 1);
        break;
      }
      case 'ArrowLeft':
      case 'ArrowUp': {
        event.preventDefault();
        selectIndex(index === 0 ? last : index - 1);
        break;
      }
      case ' ':
      case 'Enter': {
        event.preventDefault();
        selectIndex(index);
        break;
      }
      default: {
        break;
      }
    }
  };

  return (
    <div
      className={styles.track}
      data-testid="provider-route-toggle"
      role="radiogroup"
      style={PROVIDER_ROUTE_TOGGLE_TRACK_STYLE}
    >
      {options.map((option, index) => {
        const checked = value === option.value;
        const tabStop = checked || (value === undefined && index === 0);
        return (
          <button
            aria-checked={checked}
            className={cx(styles.item, checked && styles.itemActive)}
            disabled={disabled}
            key={option.value}
            onClick={() => onChange?.(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            ref={(node) => {
              buttonRefs.current[index] = node;
            }}
            role="radio"
            style={PROVIDER_ROUTE_TOGGLE_ITEM_STYLE}
            tabIndex={tabStop ? 0 : -1}
            type="button"
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
};

export default ProviderRouteToggle;
