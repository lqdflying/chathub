import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('React', React);

vi.mock('@/store/chat', () => ({
  useChatStore: () => false,
}));

vi.mock('./Inspector', () => ({
  default: ({ showPluginRender }: { showPluginRender: boolean }) => (
    <div data-testid="inspector-plugin-render">{String(showPluginRender)}</div>
  ),
}));

vi.mock('./Render', () => ({
  default: ({ showPluginRender }: { showPluginRender: boolean }) => (
    <div data-testid="render-plugin-render">{String(showPluginRender)}</div>
  ),
}));

vi.mock('@/components/AnimatedCollapsed', () => ({
  default: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div>{children}</div> : null,
}));

import Tool from './index';

const base = {
  apiName: 'python',
  id: 'call-1',
  identifier: 'lobe-code-interpreter',
  index: 0,
  messageId: 'm1',
  payload: {},
};

describe('AssistantTool', () => {
  it('starts builtin tools on the plugin UI', () => {
    render(<Tool {...base} type="builtin" />);

    expect(screen.getByTestId('inspector-plugin-render').textContent).toBe('true');
    expect(screen.getByTestId('render-plugin-render').textContent).toBe('true');
  });

  it('starts non-builtin tools on the JSON inspector', () => {
    render(<Tool {...base} type="default" />);

    expect(screen.getByTestId('inspector-plugin-render').textContent).toBe('false');
    expect(screen.getByTestId('render-plugin-render').textContent).toBe('false');
  });
});
