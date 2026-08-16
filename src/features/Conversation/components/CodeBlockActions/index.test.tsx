import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderCodeBlockActions, renderCodeBlockBody } from './index';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => {
      if (key === 'CodeBlock.expand') return `Expand all ${options?.count} lines`;
      if (key === 'CodeBlock.collapse') return 'Collapse code';
      return key;
    },
  }),
}));

// the real HtmlPreviewAction pulls in the workspace/server-config zustand store
// (needs a provider); stub it so the action-routing assertions stay lightweight
vi.mock('@/components/HtmlPreview', () => ({
  HtmlPreviewAction: () => <button data-testid={'html-preview-action'}>preview</button>,
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

  it('keeps a bare html fragment as source with the eye-icon preview still available', () => {
    const fragment = '<div class="card">done</div>';
    const originalNode = <pre>source</pre>;

    // a fragment is not inlined — it renders as ordinary source, no iframe
    expect(renderCodeBlockBody({ content: fragment, language: 'html', originalNode } as any)).toBe(
      originalNode,
    );

    // but the on-demand full-screen preview (eye icon) is still offered
    const { container } = render(
      <>
        {renderCodeBlockActions({
          actionIconSize: 'small',
          content: fragment,
          language: 'html',
          originalNode: null,
        } as any)}
      </>,
    );
    expect(container.querySelector('[data-testid="html-preview-action"]')).not.toBeNull();
  });

  it('omits the word-wrap control for visual blocks but keeps it for code', () => {
    const visual = render(
      <>
        {renderCodeBlockActions({
          actionIconSize: 'small',
          content: '<svg></svg>',
          language: 'svg',
          originalNode: null,
        } as any)}
      </>,
    );
    // the wrap toggle would walk the DOM and restyle an unrelated <pre>
    expect(visual.container.querySelector('.lucide-text-wrap')).toBeNull();
    visual.unmount();

    const normal = render(
      <>
        {renderCodeBlockActions({
          actionIconSize: 'small',
          content: 'const a = 1',
          language: 'ts',
          originalNode: null,
        } as any)}
      </>,
    );
    expect(normal.container.querySelector('.lucide-text-wrap')).not.toBeNull();
  });

  it('downloads a content-detected diagram with its effective extension', () => {
    const created: HTMLAnchorElement[] = [];
    const origCreate = document.createElement.bind(document);
    const createSpy = vi.spyOn(document, 'createElement').mockImplementation(((
      tag: string,
      opts?: any,
    ) => {
      const el = origCreate(tag, opts);
      if (tag === 'a') {
        (el as HTMLAnchorElement).click = vi.fn();
        created.push(el as HTMLAnchorElement);
      }
      return el;
    }) as any);
    (URL as any).createObjectURL = vi.fn(() => 'blob:x');
    (URL as any).revokeObjectURL = vi.fn();

    // an SVG the model mislabeled as "plaintext"
    const { container } = render(
      <>
        {renderCodeBlockActions({
          actionIconSize: 'small',
          content: '<svg viewBox="0 0 1 1"></svg>',
          language: 'plaintext',
          originalNode: null,
        } as any)}
      </>,
    );
    fireEvent.click(container.querySelector('.lucide-download')!.closest('[role="button"]')!);

    expect(created.at(-1)?.download).toBe('code.svg');
    createSpy.mockRestore();
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
