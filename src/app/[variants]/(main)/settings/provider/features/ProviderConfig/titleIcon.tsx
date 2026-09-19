'use client';

import { Avatar } from '@lobehub/ui';
import React, { CSSProperties, memo } from 'react';

/** Provider detail title row is 24px; logos must match or overflow:hidden crops them. */
export const PROVIDER_CONFIG_TITLE_ICON_SIZE = 24;

export const providerConfigTitleRowStyle = (enabled: boolean): CSSProperties => ({
  flex: 1,
  height: PROVIDER_CONFIG_TITLE_ICON_SIZE,
  maxHeight: PROVIDER_CONFIG_TITLE_ICON_SIZE,
  maxWidth: '100%',
  minWidth: 0,
  overflow: 'hidden',
  ...(enabled ? {} : { filter: 'grayscale(100%)', maxHeight: PROVIDER_CONFIG_TITLE_ICON_SIZE, opacity: 0.66 }),
});

export interface ProviderConfigCustomLogoProps {
  logoUrl: string;
  title: string;
}

export const ProviderConfigCustomLogo = memo<ProviderConfigCustomLogoProps>(({ logoUrl, title }) => (
  <Avatar avatar={logoUrl} shape={'circle'} size={PROVIDER_CONFIG_TITLE_ICON_SIZE} title={title} />
));

ProviderConfigCustomLogo.displayName = 'ProviderConfigCustomLogo';
