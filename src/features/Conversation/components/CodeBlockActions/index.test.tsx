import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
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

  it('renders a complete svg block in a script-only sandboxed iframe', () => {
    const { container } = render(
      <>
        {renderCodeBlockBody({
          content: '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
          language: 'svg',
          originalNode: <pre>source</pre>,
        } as any)}
      </>,
    );

    const iframe = container.querySelector('iframe');
    expect(iframe).not.toBeNull();
    // the load-bearing security control: allow-scripts but NEVER allow-same-origin
    expect(iframe?.getAttribute('sandbox')).toBe('allow-scripts');
  });

  it('renders a complete html document in a script-only sandboxed iframe', () => {
    const { container } = render(
      <>
        {renderCodeBlockBody({
          content: '<!DOCTYPE html><html><body><h1>hi</h1></body></html>',
          language: 'html',
          originalNode: <pre>source</pre>,
        } as any)}
      </>,
    );

    const sandbox = container.querySelector('iframe')?.getAttribute('sandbox');
    expect(sandbox).toBe('allow-scripts');
    expect(sandbox).not.toContain('allow-same-origin');
  });

  it('keeps an incomplete (streaming) visual block as source', () => {
    const { container } = render(
      <>
        {renderCodeBlockBody({
          content: '<svg viewBox="0 0 10 10"><rect',
          language: 'svg',
          originalNode: <pre data-testid={'src'}>partial</pre>,
        } as any)}
      </>,
    );

    expect(container.querySelector('iframe')).toBeNull();
    expect(container.textContent).toContain('partial');
  });

  it('lets keyboard users expand and collapse long code blocks', async () => {
    const user = userEvent.setup();
    const content = Array.from({ length: 101 }, (_, i) => `line ${i + 1}`).join('\n');

    render(<>{renderCodeBlockBody({ content, originalNode: <pre>{content}</pre> } as any)}</>);

    const button = screen.getByRole('button', { name: 'Expand all 101 lines' });
    button.focus();
    expect(button.getAttribute('aria-expanded')).toBe('false');

    await user.keyboard('{Enter}');
    expect(
      screen.getByRole('button', { name: 'Collapse code' }).getAttribute('aria-expanded'),
    ).toBe('true');

    await user.keyboard(' ');
    expect(
      screen.getByRole('button', { name: 'Expand all 101 lines' }).getAttribute('aria-expanded'),
    ).toBe('false');
  });
});
