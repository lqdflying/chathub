import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@lobehub/icons', () => ({
  ModelIcon: ({ model, style, type }: { model: string; style?: object; type?: string }) => (
    <div
      data-model={model}
      data-style={JSON.stringify(style ?? null)}
      data-testid="package-model-icon"
      data-type={type ?? ''}
    />
  ),
  ProviderCombine: ({ provider }: { provider: string }) => (
    <div data-provider={provider} data-testid="package-provider-combine" />
  ),
  ProviderIcon: ({
    provider,
    style,
    type,
  }: {
    provider: string;
    style?: object;
    type?: string;
  }) => (
    <div
      data-provider={provider}
      data-style={JSON.stringify(style ?? null)}
      data-testid="package-provider-icon"
      data-type={type ?? ''}
    />
  ),
}));

vi.mock('@lobehub/ui', () => ({
  Avatar: ({
    alt,
    avatar,
    shape,
    style,
  }: {
    alt?: string;
    avatar?: string;
    shape?: string;
    style?: object;
  }) => (
    <img
      alt={alt}
      data-shape={shape ?? ''}
      data-style={JSON.stringify(style ?? null)}
      data-testid="local-avatar"
      src={avatar}
    />
  ),
}));

import { ModelBrandIcon, PROVIDER_SETTINGS_AVATAR_STYLE, ProviderBrandIcon } from './index';

describe('ProviderBrandIcon', () => {
  it('renders an inline currentColor SVG for mimo mono (not an img of mimo.svg)', () => {
    const { container } = render(
      <div style={{ color: '#fff' }}>
        <ProviderBrandIcon provider={'mimo'} size={20} type={'mono'} />
      </div>,
    );

    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute('fill')).toBe('currentColor');
    expect(container.querySelector('img[src*="mimo.svg"]')).toBeNull();
    expect(screen.queryByTestId('package-provider-icon')).toBeNull();
  });

  it('uses the avatar webp for mimo avatar mode and follows caller geometry', () => {
    render(
      <ProviderBrandIcon
        provider={'mimo'}
        size={24}
        style={PROVIDER_SETTINGS_AVATAR_STYLE}
        type={'avatar'}
      />,
    );
    const img = screen.getByTestId('local-avatar');
    expect(img.getAttribute('src')).toBe('/icons/providers/mimo-avatar.webp');
    expect(img.getAttribute('data-shape')).toBe('square');
    expect(img.getAttribute('data-style')).toContain('"borderRadius":6');
  });

  it('keeps package-default circle when callers omit style (API-key recovery avatar)', () => {
    render(<ProviderBrandIcon provider={'openai'} size={80} type={'avatar'} />);
    const el = screen.getByTestId('package-provider-icon');
    expect(el.getAttribute('data-provider')).toBe('openai');
    expect(el.getAttribute('data-style')).toBe('null');
  });

  it('uses circle for unstyled local mimo avatar (same contract as package default)', () => {
    render(<ProviderBrandIcon provider={'mimo'} size={80} type={'avatar'} />);
    const img = screen.getByTestId('local-avatar');
    expect(img.getAttribute('data-shape')).toBe('circle');
    expect(img.getAttribute('data-style')).toBe('null');
  });

  it('applies Settings rounded-square style when the caller passes it', () => {
    render(
      <ProviderBrandIcon
        provider={'openai'}
        size={24}
        style={PROVIDER_SETTINGS_AVATAR_STYLE}
        type={'avatar'}
      />,
    );
    const el = screen.getByTestId('package-provider-icon');
    expect(el.getAttribute('data-style')).toContain('"borderRadius":6');
  });
});

describe('ModelBrandIcon', () => {
  it('uses the avatar webp for default mimo model rows', () => {
    render(<ModelBrandIcon model={'mimo-v2.5-pro'} size={22} />);
    const img = screen.getByTestId('local-avatar');
    expect(img.getAttribute('src')).toBe('/icons/providers/mimo-avatar.webp');
    expect(img.getAttribute('data-shape')).toBe('circle');
  });

  it('renders inline mono SVG for mimo type=mono', () => {
    const { container } = render(<ModelBrandIcon model={'mimo-v2.5'} size={20} type={'mono'} />);
    expect(container.querySelector('svg')?.getAttribute('fill')).toBe('currentColor');
    expect(container.querySelector('img')).toBeNull();
  });

  it('falls back to package ModelIcon for unrelated models', () => {
    render(<ModelBrandIcon model={'deepseek-chat'} size={20} />);
    expect(screen.getByTestId('package-model-icon').getAttribute('data-model')).toBe(
      'deepseek-chat',
    );
  });
});
