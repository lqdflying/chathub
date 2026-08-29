import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App, ConfigProvider } from 'antd';
import React, { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('React', React);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
  }),
}));

vi.mock('@/features/AgentSetting/AgentPrompt/TokenTag', () => ({ default: () => null }));

import { AgentSettingsProvider } from '../AgentSettingsProvider';
import DynamicMemory from './DynamicMemory';

interface HarnessProps {
  initialMemory: string;
  onRefreshConfig?: () => Promise<void> | void;
  // rejects like a failed/aborted write; may also flip `persisted` first to
  // simulate a post-commit abort (server kept the new value)
  onSaveWrite: (nextMemory: string, persisted: { current: string }) => Promise<void>;
}

/**
 * Models the production layers faithfully: the source store applies the write
 * optimistically (like `internal_dispatchAgentMap`), the persistence promise
 * rejects, and `onRefreshConfig` re-reads database truth into the source. The
 * macrotask yield stands in for real network latency so the optimistic value
 * renders before the rejection lands — otherwise React batches the optimistic
 * and refreshed updates into a no-op, which production never sees because the
 * agent store notifies subscribers per set and the refresh lands ticks later.
 */
const Harness = ({ initialMemory, onRefreshConfig, onSaveWrite }: HarnessProps) => {
  const persisted = useRef(initialMemory);
  const [memory, setMemory] = useState(initialMemory);

  return (
    <ConfigProvider>
      <App>
        <AgentSettingsProvider
          config={{ assistantMemory: memory } as any}
          id={'session-1'}
          meta={{} as any}
          onConfigChange={async (next: any) => {
            setMemory(next.assistantMemory);
            await new Promise((resolve) => setTimeout(resolve, 0));
            await onSaveWrite(next.assistantMemory, persisted);
          }}
          onRefreshConfig={
            onRefreshConfig
              ? async () => {
                  await onRefreshConfig();
                  setMemory(persisted.current);
                }
              : undefined
          }
        >
          <DynamicMemory />
        </AgentSettingsProvider>
      </App>
    </ConfigProvider>
  );
};

const getEditor = () => screen.getByPlaceholderText('settingChatMemory.dynamicMemory.empty');
const getSaveButton = () =>
  screen.getByRole('button', { name: /settingChatMemory\.dynamicMemory\.save/ });

const collectUnhandledRejections = () => {
  const reasons: unknown[] = [];
  const onUnhandled = (reason: unknown) => {
    reasons.push(reason);
  };
  process.on('unhandledRejection', onUnhandled);
  return {
    reasons,
    stop: () => process.off('unhandledRejection', onUnhandled),
  };
};

const createDeferred = <T = void>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
};

describe('DynamicMemory failed-write reconciliation', () => {
  it('failed Save refetches and restores the persisted memory', async () => {
    const user = userEvent.setup();
    const onSaveWrite = vi.fn(async () => {
      throw new Error('network down');
    });
    const onRefreshConfig = vi.fn();

    render(
      <Harness
        initialMemory={'persisted memory'}
        onRefreshConfig={onRefreshConfig}
        onSaveWrite={onSaveWrite}
      />,
    );

    const editor = await screen.findByDisplayValue('persisted memory');
    await user.clear(editor);
    await user.type(editor, 'edited memory');
    await user.click(screen.getByRole('button', { name: 'settingChatMemory.dynamicMemory.save' }));

    await waitFor(() => {
      expect(onRefreshConfig).toHaveBeenCalledTimes(1);
    });
    // database truth (unchanged) flows back into the editor
    await waitFor(() => {
      expect((getEditor() as HTMLTextAreaElement).value).toBe('persisted memory');
    });

    // the same edit stays retryable (regex name: antd keeps the loading icon
    // mounted after `loading` flips false in happy-dom, prefixing the
    // accessible name with "loading")
    await user.clear(getEditor());
    await user.type(getEditor(), 'second attempt');
    const save = screen.getByRole('button', { name: /settingChatMemory\.dynamicMemory\.save/ });
    expect(save.hasAttribute('disabled')).toBe(false);
    await user.click(save);
    await waitFor(() => {
      expect(onSaveWrite).toHaveBeenCalledTimes(2);
    });
  });

  it('failed Clear refetches and restores the persisted memory', async () => {
    const user = userEvent.setup();
    const onSaveWrite = vi.fn(async () => {
      throw new Error('network down');
    });
    const onRefreshConfig = vi.fn();

    render(
      <Harness
        initialMemory={'persisted memory'}
        onRefreshConfig={onRefreshConfig}
        onSaveWrite={onSaveWrite}
      />,
    );

    await screen.findByDisplayValue('persisted memory');
    await user.click(screen.getByRole('button', { name: 'settingChatMemory.clear' }));

    const modal = await screen.findByRole('dialog');
    await user.click(within(modal).getByRole('button', { name: 'settingChatMemory.clear' }));

    await waitFor(() => {
      expect(onRefreshConfig).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect((getEditor() as HTMLTextAreaElement).value).toBe('persisted memory');
    });
  });

  it('post-commit rejection keeps the committed value instead of rolling back', async () => {
    const user = userEvent.setup();
    // server committed before the client saw the abort: the refetch returns
    // the NEW value, so the UI must converge on it rather than the old draft
    const onSaveWrite = vi.fn(async (nextMemory: string, persisted: { current: string }) => {
      persisted.current = nextMemory;
      throw new Error('aborted after commit');
    });
    const onRefreshConfig = vi.fn();

    render(
      <Harness
        initialMemory={'persisted memory'}
        onRefreshConfig={onRefreshConfig}
        onSaveWrite={onSaveWrite}
      />,
    );

    const editor = await screen.findByDisplayValue('persisted memory');
    await user.clear(editor);
    await user.type(editor, 'committed anyway');
    await user.click(screen.getByRole('button', { name: 'settingChatMemory.dynamicMemory.save' }));

    await waitFor(() => {
      expect(onRefreshConfig).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect((getEditor() as HTMLTextAreaElement).value).toBe('committed anyway');
    });
  });

  it('failed Save plus failed refresh keeps the draft retryable', async () => {
    const user = userEvent.setup();
    const unhandled = collectUnhandledRejections();
    const onSaveWrite = vi.fn(async () => {
      throw new Error('network down');
    });
    const onRefreshConfig = vi.fn(async () => {
      throw new Error('refresh down');
    });

    render(
      <Harness
        initialMemory={'persisted memory'}
        onRefreshConfig={onRefreshConfig}
        onSaveWrite={onSaveWrite}
      />,
    );

    const editor = await screen.findByDisplayValue('persisted memory');
    await user.clear(editor);
    await user.type(editor, 'edited memory');
    await user.click(screen.getByRole('button', { name: 'settingChatMemory.dynamicMemory.save' }));

    await waitFor(() => {
      expect(onRefreshConfig).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect((getEditor() as HTMLTextAreaElement).value).toBe('edited memory');
      expect(getSaveButton().hasAttribute('disabled')).toBe(false);
    });
    expect(unhandled.reasons).toEqual([]);
    unhandled.stop();

    await user.click(getSaveButton());
    await waitFor(() => {
      expect(onSaveWrite).toHaveBeenCalledTimes(2);
    });
  });

  it('failed Clear plus failed refresh keeps the empty draft retryable', async () => {
    const user = userEvent.setup();
    const unhandled = collectUnhandledRejections();
    const onSaveWrite = vi.fn(async () => {
      throw new Error('network down');
    });
    const onRefreshConfig = vi.fn(async () => {
      throw new Error('refresh down');
    });

    render(
      <Harness
        initialMemory={'persisted memory'}
        onRefreshConfig={onRefreshConfig}
        onSaveWrite={onSaveWrite}
      />,
    );

    await screen.findByDisplayValue('persisted memory');
    await user.click(screen.getByRole('button', { name: 'settingChatMemory.clear' }));
    const modal = await screen.findByRole('dialog');
    await user.click(within(modal).getByRole('button', { name: 'settingChatMemory.clear' }));

    await waitFor(() => {
      expect(onRefreshConfig).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect((getEditor() as HTMLTextAreaElement).value).toBe('');
      expect(getSaveButton().hasAttribute('disabled')).toBe(false);
    });
    expect(unhandled.reasons).toEqual([]);
    unhandled.stop();

    await user.click(getSaveButton());
    await waitFor(() => {
      expect(onSaveWrite).toHaveBeenCalledTimes(2);
    });
  });

  it('failed Save with no refresh callback keeps the draft retryable', async () => {
    const user = userEvent.setup();
    const unhandled = collectUnhandledRejections();
    const onSaveWrite = vi.fn(async () => {
      throw new Error('network down');
    });

    render(<Harness initialMemory={'persisted memory'} onSaveWrite={onSaveWrite} />);

    const editor = await screen.findByDisplayValue('persisted memory');
    await user.clear(editor);
    await user.type(editor, 'edited memory');
    await user.click(screen.getByRole('button', { name: 'settingChatMemory.dynamicMemory.save' }));

    await waitFor(() => {
      expect((getEditor() as HTMLTextAreaElement).value).toBe('edited memory');
      expect(getSaveButton().hasAttribute('disabled')).toBe(false);
    });
    expect(unhandled.reasons).toEqual([]);
    unhandled.stop();
  });

  it('failed Save plus failed refresh keeps later in-flight typing', async () => {
    const user = userEvent.setup();
    const unhandled = collectUnhandledRejections();
    const write = createDeferred();
    const refresh = createDeferred();
    const onSaveWrite = vi.fn(() => write.promise);
    const onRefreshConfig = vi.fn(() => refresh.promise);

    render(
      <Harness
        initialMemory={'persisted memory'}
        onRefreshConfig={onRefreshConfig}
        onSaveWrite={onSaveWrite}
      />,
    );

    const editor = await screen.findByDisplayValue('persisted memory');
    await user.clear(editor);
    await user.type(editor, 'edited memory');
    await user.click(screen.getByRole('button', { name: 'settingChatMemory.dynamicMemory.save' }));

    await waitFor(() => {
      expect(onSaveWrite).toHaveBeenCalledTimes(1);
    });
    await user.clear(getEditor());
    await user.type(getEditor(), 'newer edits');

    write.reject(new Error('network down'));
    await waitFor(() => {
      expect(onRefreshConfig).toHaveBeenCalledTimes(1);
    });
    refresh.reject(new Error('refresh down'));

    await waitFor(() => {
      expect((getEditor() as HTMLTextAreaElement).value).toBe('newer edits');
      expect(getSaveButton().hasAttribute('disabled')).toBe(false);
    });
    expect(unhandled.reasons).toEqual([]);
    unhandled.stop();
  });

  it('failed Clear plus failed refresh keeps later in-flight typing', async () => {
    const user = userEvent.setup();
    const unhandled = collectUnhandledRejections();
    const write = createDeferred();
    const refresh = createDeferred();
    const onSaveWrite = vi.fn(() => write.promise);
    const onRefreshConfig = vi.fn(() => refresh.promise);

    render(
      <Harness
        initialMemory={'persisted memory'}
        onRefreshConfig={onRefreshConfig}
        onSaveWrite={onSaveWrite}
      />,
    );

    await screen.findByDisplayValue('persisted memory');
    await user.click(screen.getByRole('button', { name: 'settingChatMemory.clear' }));
    const modal = await screen.findByRole('dialog');
    await user.click(within(modal).getByRole('button', { name: 'settingChatMemory.clear' }));

    await waitFor(() => {
      expect(onSaveWrite).toHaveBeenCalledTimes(1);
    });
    await user.type(getEditor(), 'typed after clear');

    write.reject(new Error('network down'));
    await waitFor(() => {
      expect(onRefreshConfig).toHaveBeenCalledTimes(1);
    });
    refresh.reject(new Error('refresh down'));

    await waitFor(() => {
      expect((getEditor() as HTMLTextAreaElement).value).toBe('typed after clear');
      expect(getSaveButton().hasAttribute('disabled')).toBe(false);
    });
    expect(unhandled.reasons).toEqual([]);
    unhandled.stop();
  });
});
