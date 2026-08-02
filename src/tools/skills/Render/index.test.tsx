import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import SkillLoaderRender from './index';

vi.stubGlobal('React', React);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, params: { name: string }) => `Loaded skill: ${params.name}`,
  }),
}));

const renderSkillLoader = (content: any) =>
  render(<SkillLoaderRender args={{}} content={content} messageId="message-1" />);

describe('SkillLoaderRender', () => {
  it('renders a compact loaded marker', () => {
    renderSkillLoader({
      contentHash: 'hash-reviewer',
      identifier: 'reviewer',
      name: 'reviewer',
      status: 'loaded',
    });

    expect(screen.getByText('Loaded skill: reviewer')).toBeTruthy();
  });

  it('renders nothing for malformed content', () => {
    const { container } = renderSkillLoader({ identifier: 'reviewer', status: 'loaded' });

    expect(container.innerHTML).toBe('');
  });
});
