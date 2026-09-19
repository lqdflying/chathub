import { ConfigProvider } from 'antd';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { Flexbox } from 'react-layout-kit';
import { describe, expect, it } from 'vitest';

import {
  PROVIDER_CONFIG_TITLE_ICON_SIZE,
  ProviderConfigCustomLogo,
  providerConfigTitleRowStyle,
} from './titleIcon';

const PIXEL_GIF =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

describe('ProviderConfig title custom logo', () => {
  it('keeps the custom logo at the clipped header size so overflow cannot crop it', () => {
    const { container } = render(
      <ConfigProvider>
        <Flexbox
          align={'center'}
          data-testid={'title-row'}
          horizontal
          style={providerConfigTitleRowStyle(true)}
        >
          <ProviderConfigCustomLogo logoUrl={PIXEL_GIF} title={'Acme'} />
        </Flexbox>
      </ConfigProvider>,
    );

    expect(PROVIDER_CONFIG_TITLE_ICON_SIZE).toBe(24);

    const row = screen.getByTestId('title-row');
    expect(row.style.height).toBe('24px');
    expect(row.style.maxHeight).toBe('24px');
    expect(row.style.overflow).toBe('hidden');
    expect(['0', '0px']).toContain(row.style.minWidth);
    expect(row.style.maxWidth).toBe('100%');
    expect(['1', '1 1 0%', '1 1 0']).toContain(row.style.flex);

    const avatar = container.querySelector('.ant-avatar') as HTMLElement | null;
    expect(avatar).toBeTruthy();
    expect(avatar?.style.width).toBe('24px');
    expect(avatar?.style.height).toBe('24px');
  });

  it('does not use the previous 32px custom-logo size', () => {
    const { container } = render(
      <ConfigProvider>
        <ProviderConfigCustomLogo logoUrl={PIXEL_GIF} title={'Acme'} />
      </ConfigProvider>,
    );
    const avatar = container.querySelector('.ant-avatar') as HTMLElement | null;
    expect(avatar?.style.width).not.toBe('32px');
    expect(avatar?.style.height).not.toBe('32px');
  });
});
