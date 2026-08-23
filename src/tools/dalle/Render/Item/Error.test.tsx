import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import defaultTool from '@/locales/default/tool';

import enTool from '../../../../../locales/en-US/tool.json';
import zhTool from '../../../../../locales/zh-CN/tool.json';
import ErrorCard from './Error';

// repo convention: namespace-prefixed key passthrough — assertions prove the
// component SELECTS the localized tool key (never hard-coded English copy);
// the locale-resource test below proves both required locales carry it
vi.mock('react-i18next', () => ({
  useTranslation: (ns?: string) => ({ t: (key: string) => `${ns}:${key}` }),
}));

vi.mock('@lobehub/ui', () => ({
  Alert: ({ message, extra }: { extra?: React.ReactNode; message?: React.ReactNode }) => (
    <div>
      <div data-testid="alert-title">{message}</div>
      <div>{extra}</div>
    </div>
  ),
  Button: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => (
    <button onClick={onClick} type="button">
      {children}
    </button>
  ),
  Highlighter: ({ children }: { children?: React.ReactNode }) => <pre>{children}</pre>,
}));

const retryDallEImages = vi.fn();
const errorState: { current: unknown } = {
  current: { errorType: 'ChatImageTaskUnverified' },
};
vi.mock('@/store/chat', () => ({
  useChatStore: (selector: (s: unknown) => unknown) => selector({ retryDallEImages } as unknown),
}));
vi.mock('@/store/chat/selectors', () => ({
  chatSelectors: {
    getMessageById: () => () => ({ pluginState: { error: [errorState.current] } }),
  },
}));

describe('dalle item Error card', () => {
  it('renders the localized restore notice for ChatImageTaskUnverified with a Retry action', () => {
    errorState.current = { errorType: 'ChatImageTaskUnverified' };
    render(<ErrorCard index={0} messageId="m1" />);

    // the stable type resolves through the tool namespace — no English copy
    // baked into the action or the card
    expect(screen.getByTestId('alert-title').textContent).toBe('tool:dalle.taskUnverified');

    fireEvent.click(screen.getByRole('button'));
    expect(retryDallEImages).toHaveBeenCalledWith('m1');
  });

  it('renders the localized stop notice for ChatImageTaskCancelled with a Retry action', () => {
    errorState.current = { errorType: 'ChatImageTaskCancelled' };
    render(<ErrorCard index={0} messageId="m1" />);

    expect(screen.getByTestId('alert-title').textContent).toBe('tool:dalle.taskCancelled');
    fireEvent.click(screen.getByRole('button'));
    expect(retryDallEImages).toHaveBeenCalledWith('m1');
  });

  it('keeps the no-model error on its own localized key', () => {
    errorState.current = { errorType: 'NoImageModelConfigured' };
    render(<ErrorCard index={0} messageId="m2" />);
    expect(screen.getByTestId('alert-title').textContent).toBe('tool:dalle.noImageModel');
  });

  it('ships the restore and stop notices in every hand-maintained locale resource', () => {
    // default TS namespace + both required JSON locales must carry the key
    // (the repo forbids running the i18n generator from a session)
    const unverified = [
      defaultTool.dalle.taskUnverified,
      (zhTool as { dalle: Record<string, string> }).dalle.taskUnverified,
      (enTool as { dalle: Record<string, string> }).dalle.taskUnverified,
    ];
    const cancelled = [
      defaultTool.dalle.taskCancelled,
      (zhTool as { dalle: Record<string, string> }).dalle.taskCancelled,
      (enTool as { dalle: Record<string, string> }).dalle.taskCancelled,
    ];
    for (const value of [...unverified, ...cancelled]) {
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
    }
    // zh-CN and en-US are separately maintained translations, not copies
    expect(unverified[1]).not.toBe(unverified[2]);
    expect(cancelled[1]).not.toBe(cancelled[2]);
    // the English copy names the Retry action the card renders
    expect(unverified[2]).toContain('Retry');
    expect(cancelled[2]).toContain('Retry');
  });
});
