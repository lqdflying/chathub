import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ChatAppearance from './index';

vi.stubGlobal('React', React);

const mocks = vi.hoisted(() => ({
  state: {
    defaultSettings: {
      general: {
        fontSize: 14,
        highlighterTheme: 'github-dark',
        mermaidTheme: 'default',
        transitionMode: 'none',
      },
    },
    isUserStateInit: true,
    preference: { disableInputMarkdownRender: true },
    setSettings: vi.fn(),
    settings: {},
    updatePreference: vi.fn(),
  },
}));

vi.mock('@/store/user', () => ({
  useUserStore: (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state),
}));

vi.mock('@lobehub/ui', () => ({
  Form: ({ items }: { items: Array<{ children: Array<{ children: React.ReactNode }> }> }) => (
    <>{items.flatMap((group) => group.children.map((item) => item.children))}</>
  ),
  Icon: () => null,
  Segmented: () => null,
  Select: () => null,
  SliderWithInput: () => null,
  highlighterThemes: [],
  mermaidThemes: [],
}));

vi.mock('antd', () => ({
  Skeleton: () => <div>Loading</div>,
  Switch: ({
    checked,
    loading,
    onChange,
    ...rest
  }: {
    checked: boolean;
    loading: boolean;
    onChange: (checked: boolean) => void;
  }) => (
    <button
      aria-checked={checked}
      disabled={loading}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
      {...rest}
    />
  ),
}));

vi.mock('antd-style', () => ({
  useTheme: () => ({ colorWarning: '#f0a000' }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('./ChatPreview', () => ({ default: () => null }));
vi.mock('./ChatTransitionPreview', () => ({ default: () => null }));
vi.mock('./HighlighterPreview', () => ({ default: () => null }));
vi.mock('./MermaidPreview', () => ({ default: () => null }));

describe('ChatAppearance input Markdown preference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.preference.disableInputMarkdownRender = true;
  });

  it('moves the Labs preference into an accessible, persisted switch', async () => {
    let finishUpdate: (() => void) | undefined;
    mocks.state.updatePreference.mockReturnValue(
      new Promise<void>((resolve) => {
        finishUpdate = resolve;
      }),
    );

    render(<ChatAppearance />);

    const toggle = screen.getByRole('switch', {
      name: 'settingChatAppearance.inputMarkdown.title',
    }) as HTMLButtonElement;
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(toggle);

    expect(mocks.state.updatePreference).toHaveBeenCalledWith({
      disableInputMarkdownRender: false,
    });
    expect(toggle.disabled).toBe(true);

    finishUpdate?.();
    await waitFor(() => expect(toggle.disabled).toBe(false));
  });
});
