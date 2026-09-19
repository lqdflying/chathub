'use client';

import { createStyles } from 'antd-style';
import React from 'react';

/**
 * Equal-width Chat Completions | Responses API control.
 *
 * Do not use antd Radio.Group `block` or Segmented `block` here. Both start as
 * content-sized / inline-block, then CSS-in-JS injects flex ~1s after a hard
 * refresh; the selected thumb or item becomes the full pane and the other
 * label is clipped by SettingContainer overflow-x hidden.
 *
 * @see https://ant.design/components/segmented
 * @see https://ant.design/docs/blog/css-in-js
 * @see https://ant.design/docs/blog/hydrate-cssinjs
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

const useStyles = createStyles(({ css, token }) => ({
  item: css`
    box-sizing: border-box;
    min-width: 0;
    margin: 0;
    padding-block: 4px;
    padding-inline: 8px;
    overflow: hidden;
    border: 0;
    border-radius: ${token.borderRadius}px;
    background: transparent;
    color: ${token.colorTextSecondary};
    font: inherit;
    line-height: 22px;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;

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
    box-sizing: border-box;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 2px;
    width: 100%;
    max-width: 100%;
    min-width: 0;
    padding: 2px;
    border-radius: ${token.borderRadiusLG}px;
    background: ${token.colorFillTertiary};
  `,
}));

const ProviderRouteToggle = ({ disabled, onChange, options, value }: ProviderRouteToggleProps) => {
  const { cx, styles } = useStyles();

  return (
    <div className={styles.track} role="radiogroup">
      {options.map((option) => {
        const checked = value === option.value;
        return (
          <button
            aria-checked={checked}
            className={cx(styles.item, checked && styles.itemActive)}
            disabled={disabled}
            key={option.value}
            onClick={() => onChange?.(option.value)}
            role="radio"
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
