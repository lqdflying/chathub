import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { applyLightScrollMarkdownProps } from './lightScrollMarkdown';

vi.stubGlobal('React', React);

describe('applyLightScrollMarkdownProps', () => {
  it('leaves settled props unchanged', () => {
    const props = { animated: true, rehypePlugins: [] };
    expect(applyLightScrollMarkdownProps(props, false)).toBe(props);
  });

  it('disables animation and replaces highlight while scrolling', () => {
    const next = applyLightScrollMarkdownProps({ animated: true }, true);
    expect(next.animated).toBe(false);
    expect(next.componentProps?.highlight?.bodyRender).toBeTypeOf('function');
    expect(next.componentProps?.mermaid?.bodyRender).toBeTypeOf('function');
    expect(next.componentProps?.mermaid?.enablePanZoom).toBe(false);
  });

  it('does not mount the original Mermaid/SyntaxMermaid node while scrolling', () => {
    const next = applyLightScrollMarkdownProps({ animated: true }, true);
    const SyntaxMermaid = () => {
      throw new Error('SyntaxMermaid mounted');
    };

    const node = next.componentProps?.mermaid?.bodyRender?.({
      content: 'graph TD; A-->B',
      originalNode: <SyntaxMermaid />,
    } as any);

    expect(() => render(<>{node}</>)).not.toThrow();
    expect(screen.getByText('graph TD; A-->B')).toBeTruthy();
  });
});
