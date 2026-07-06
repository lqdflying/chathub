import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderCodeBlockBody } from './index';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => {
      if (key === 'CodeBlock.expand') return `Expand all ${options?.count} lines`;
      if (key === 'CodeBlock.collapse') return 'Collapse code';
      return key;
    },
  }),
}));

describe('renderCodeBlockBody', () => {
  it('renders short code blocks without collapse controls', () => {
    const originalNode = <pre>short</pre>;

    const result = renderCodeBlockBody({
      content: 'line 1\nline 2',
      originalNode,
    } as any);

    expect(result).toBe(originalNode);
  });

  it('lets keyboard users expand and collapse long code blocks', async () => {
    const user = userEvent.setup();
    const content = Array.from({ length: 101 }, (_, i) => `line ${i + 1}`).join('\n');

    render(<>{renderCodeBlockBody({ content, originalNode: <pre>{content}</pre> } as any)}</>);

    const button = screen.getByRole('button', { name: 'Expand all 101 lines' });
    button.focus();
    expect(button.getAttribute('aria-expanded')).toBe('false');

    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Collapse code' }).getAttribute('aria-expanded')).toBe(
      'true',
    );

    await user.keyboard(' ');
    expect(
      screen.getByRole('button', { name: 'Expand all 101 lines' }).getAttribute('aria-expanded'),
    ).toBe('false');
  });
});
