'use client';

import { ModelIcon, ProviderCombine, ProviderIcon } from '@lobehub/icons';
import { Avatar } from '@lobehub/ui';
import { CSSProperties, memo } from 'react';
import { Flexbox } from 'react-layout-kit';

import {
  resolveModelLogoUrl,
  resolveProviderIcon,
  resolveProviderLogoUrl,
} from '@/utils/resolveProviderIcon';

export interface ProviderBrandIconProps {
  provider: string;
  size?: number;
  style?: CSSProperties;
  type?: 'avatar' | 'mono' | 'color';
}

/**
 * Drop-in for `@lobehub/icons` ProviderIcon with ChatHub id aliases and local
 * logo overrides (e.g. Xiaomi MiMo while `@lobehub/icons` stays on 2.x).
 */
export const ProviderBrandIcon = memo<ProviderBrandIconProps>(
  ({ provider, size = 24, style, type = 'avatar' }) => {
    const logo = resolveProviderLogoUrl(provider, type === 'mono' ? 'mono' : 'avatar');
    if (logo) {
      return (
        <Avatar
          alt={provider}
          avatar={logo}
          shape={'square'}
          size={size}
          style={{ borderRadius: 6, ...style }}
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
 * Drop-in for ProviderCombine with the same local-logo override path.
 */
export const ProviderBrandCombine = memo<ProviderBrandCombineProps>(
  ({ provider, size = 24, style, title }) => {
    const logo = resolveProviderLogoUrl(provider, 'avatar');
    if (logo) {
      return (
        <Flexbox align={'center'} gap={8} horizontal style={style}>
          <Avatar
            alt={title || provider}
            avatar={logo}
            shape={'square'}
            size={size}
            style={{ borderRadius: 6 }}
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
  type?: 'avatar' | 'mono' | 'color';
}

/** Drop-in for ModelIcon with local overrides for mimo-* ids on icons 2.x. */
export const ModelBrandIcon = memo<ModelBrandIconProps>(({ model, size = 24, type }) => {
  const logo = resolveModelLogoUrl(model);
  if (logo) {
    return (
      <Avatar
        alt={model}
        avatar={logo}
        shape={'square'}
        size={size}
        style={{ borderRadius: type === 'avatar' ? 6 : 4 }}
      />
    );
  }

  return <ModelIcon model={model} size={size} type={type} />;
});

ModelBrandIcon.displayName = 'ModelBrandIcon';
