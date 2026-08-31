'use client';

import { ModelIcon, ProviderCombine, ProviderIcon } from '@lobehub/icons';
import { Avatar } from '@lobehub/ui';
import React, { CSSProperties, memo } from 'react';
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

const wantsRoundedSquare = (style?: CSSProperties): boolean => {
  const radius = style?.borderRadius;
  if (radius === undefined || radius === null) return false;
  return radius !== '50%' && radius !== '50';
};

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
      <ProviderIcon
        provider={resolveProviderIcon(provider)}
        size={size}
        style={style}
        type={type}
      />
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
 * Drop-in for ProviderCombine. Settings-only consumers; local logo uses the
 * Settings rounded-square tile unless `style` opts into a circle.
 */
export const ProviderBrandCombine = memo<ProviderBrandCombineProps>(
  ({ provider, size = 24, style, title }) => {
    const logo = resolveProviderLogoUrl(provider, 'avatar');
    if (logo) {
      const tileStyle = { ...PROVIDER_SETTINGS_AVATAR_STYLE, ...style };
      return (
        <Flexbox align={'center'} gap={8} horizontal style={style}>
          <Avatar
            alt={title || provider}
            avatar={logo}
            shape={'square'}
            size={size}
            style={tileStyle}
          />
          {title ? (
            <span style={{ fontSize: 16, fontWeight: 'bold', lineHeight: 1 }}>{title}</span>
          ) : null}
        </Flexbox>
      );
    }

    return (
      <ProviderCombine
        provider={resolveProviderIcon(provider)}
        size={size}
        style={style}
        title={title}
      />
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

  return <ModelIcon model={model} size={size} style={style} type={type} />;
});

ModelBrandIcon.displayName = 'ModelBrandIcon';
