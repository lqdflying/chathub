'use client';

import { ModelIcon, ProviderIcon } from '@lobehub/icons';
import { Avatar } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import React, { CSSProperties, ReactNode, memo } from 'react';
import { Flexbox } from 'react-layout-kit';

import {
  hasLocalProviderMono,
  isMimoModelId,
  resolveModelLogoUrl,
  resolveProviderIcon,
  resolveProviderLogoUrl,
} from '@/utils/resolveProviderIcon';

import { XiaomiMiMoMono } from './XiaomiMiMoMono';

/** Settings provider tiles use this; do not bake it into ProviderBrandIcon defaults. */
export const PROVIDER_SETTINGS_AVATAR_STYLE: CSSProperties = { borderRadius: 6 };

const useStyles = createStyles(({ css }) => ({
  sizeLock: css`
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    overflow: hidden;

    svg {
      max-width: 100%;
      max-height: 100%;
    }
  `,
}));

const wantsRoundedSquare = (style?: CSSProperties): boolean => {
  const radius = style?.borderRadius;
  if (radius === undefined || radius === null) return false;
  return radius !== '50%' && radius !== '50';
};

const IconSizeLock = memo<{ children: ReactNode; size: number }>(({ children, size }) => {
  const { styles } = useStyles();

  return (
    <span
      className={styles.sizeLock}
      data-testid="icon-size-lock"
      style={{ height: size, width: size }}
    >
      {children}
    </span>
  );
});

IconSizeLock.displayName = 'IconSizeLock';

export interface ProviderBrandIconProps {
  provider: string;
  size?: number;
  style?: CSSProperties;
  type?: 'avatar' | 'mono' | 'color';
}

/**
 * Drop-in for `@lobehub/icons` ProviderIcon with ChatHub id aliases and local
 * logo overrides (e.g. Xiaomi MiMo while `@lobehub/icons` stays on 2.x).
 *
 * Geometry follows the caller: omit `style` for the package-default circle
 * (e.g. InvalidAPIKey 80px avatar); pass `PROVIDER_SETTINGS_AVATAR_STYLE` for
 * Settings 24px rounded squares.
 */
export const ProviderBrandIcon = memo<ProviderBrandIconProps>(
  ({ provider, size = 24, style, type = 'avatar' }) => {
    if (type === 'mono' && hasLocalProviderMono(provider)) {
      return <XiaomiMiMoMono size={size} style={style} />;
    }

    const logo = resolveProviderLogoUrl(provider, 'avatar');
    if (logo) {
      return (
        <Avatar
          alt={provider}
          avatar={logo}
          shape={wantsRoundedSquare(style) ? 'square' : 'circle'}
          size={size}
          style={style}
        />
      );
    }

    return (
      <IconSizeLock size={size}>
        <ProviderIcon
          provider={resolveProviderIcon(provider)}
          size={size}
          style={style}
          type={type}
        />
      </IconSizeLock>
    );
  },
);

ProviderBrandIcon.displayName = 'ProviderBrandIcon';

export interface ProviderBrandCombineProps {
  provider: string;
  size?: number;
  style?: CSSProperties;
  title?: string;
}

/**
 * Settings header/card mark: sized avatar tile + title for every provider.
 * Do not use `@lobehub/icons` ProviderCombine — wordmark SVGs ignore the 24px header.
 */
export const ProviderBrandCombine = memo<ProviderBrandCombineProps>(
  ({ provider, size = 24, style, title }) => {
    return (
      <Flexbox align={'center'} gap={8} horizontal style={style}>
        <ProviderBrandIcon
          provider={provider}
          size={size}
          style={PROVIDER_SETTINGS_AVATAR_STYLE}
          type={'avatar'}
        />
        {title ? (
          <span style={{ fontSize: 16, fontWeight: 'bold', lineHeight: 1 }}>{title}</span>
        ) : null}
      </Flexbox>
    );
  },
);

ProviderBrandCombine.displayName = 'ProviderBrandCombine';

export interface ModelBrandIconProps {
  model: string;
  size?: number;
  style?: CSSProperties;
  type?: 'avatar' | 'mono' | 'color';
}

/** Drop-in for ModelIcon with local overrides for mimo-* ids on icons 2.x. */
export const ModelBrandIcon = memo<ModelBrandIconProps>(({ model, size = 24, style, type }) => {
  const variant = type === 'mono' ? 'mono' : 'avatar';

  if (type === 'mono' && isMimoModelId(model)) {
    return <XiaomiMiMoMono size={size} style={style} />;
  }

  const logo = resolveModelLogoUrl(model, variant);
  if (logo) {
    return (
      <Avatar
        alt={model}
        avatar={logo}
        shape={wantsRoundedSquare(style) ? 'square' : 'circle'}
        size={size}
        style={style}
      />
    );
  }

  return (
    <IconSizeLock size={size}>
      <ModelIcon model={model} size={size} style={style} type={type} />
    </IconSizeLock>
  );
});

ModelBrandIcon.displayName = 'ModelBrandIcon';
