import { describe, expect, it } from 'vitest';

import { applyLightScrollMarkdownProps } from './lightScrollMarkdown';

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
});
