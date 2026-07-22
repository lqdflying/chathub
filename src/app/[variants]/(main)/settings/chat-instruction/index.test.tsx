import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React, {
  type PropsWithChildren,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ChatInstruction from './index';

vi.stubGlobal('React', React);

const setSettings = vi.fn();

const userStoreState = {
  isUserStateInit: true,
  setSettings,
  settings: {
    general: {
      generalInstruction: '',
    },
  },
};

vi.mock('@lobehub/ui', () => {
  const Form = ({
    items,
  }: {
    items: Array<{ children?: ReactNode; extra?: ReactNode; title?: ReactNode }>;
  }) => (
    <div>
      {items.map((group, index) => (
        <section data-testid="instruction-section" key={index}>
          <header>
            <div>{group.title}</div>
            {group.extra}
          </header>
          {group.children}
        </section>
      ))}
    </div>
  );

  return {
    Button: ({
      children,
      onClick,
    }: PropsWithChildren<{ onClick?: React.MouseEventHandler<HTMLButtonElement> }>) => (
      <button onClick={onClick} type="button">
        {children}
      </button>
    ),
    Form,
    Icon: () => null,
    Text: ({ children }: PropsWithChildren) => <span>{children}</span>,
  };
});

vi.mock('@lobehub/ui/chat', () => ({
  EditableMessage: ({
    editing,
    onChange,
    onEditingChange,
    placeholder,
    showEditWhenEmpty,
    text,
    value,
  }: {
    editing: boolean;
    onChange: (value: string) => void;
    onEditingChange: (editing: boolean) => void;
    placeholder: string;
    showEditWhenEmpty: boolean;
    text: { cancel: string; confirm: string };
    value: string;
  }) => {
    const [draft, setDraft] = useState(value);
    const wasEditing = useRef(editing);

    useEffect(() => {
      if (editing && !wasEditing.current) setDraft(value);
      wasEditing.current = editing;
    }, [editing, value]);

    return (
      <div>
        {editing ? (
          <>
            <textarea
              aria-label="instruction-editor"
              onChange={(event) => setDraft(event.target.value)}
              value={draft}
            />
            <button
              onClick={() => {
                onEditingChange(false);
                setDraft(value);
              }}
              type="button"
            >
              {text.cancel}
            </button>
            <button
              onClick={() => {
                onEditingChange(false);
                onChange(draft);
              }}
              type="button"
            >
              {text.confirm}
            </button>
          </>
        ) : (
          <>
            <div data-testid="instruction-preview">{value || placeholder}</div>
            {showEditWhenEmpty && !value && (
              <button
                aria-label="empty-instruction-edit"
                onClick={() => onEditingChange(true)}
                type="button"
              >
                edit
              </button>
            )}
          </>
        )}
      </div>
    );
  },
}));

vi.mock('antd', () => ({
  Skeleton: () => <div data-testid="skeleton" />,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { ns?: string }) => (options?.ns ? `${options.ns}:${key}` : key),
  }),
}));

vi.mock('@/store/user', () => ({
  useUserStore: Object.assign(
    (selector: (state: typeof userStoreState) => unknown) => selector(userStoreState),
    {
      setState: (
        updater:
          | Partial<typeof userStoreState>
          | ((state: typeof userStoreState) => Partial<typeof userStoreState>),
      ) => {
        const nextState = typeof updater === 'function' ? updater(userStoreState) : updater;
        Object.assign(userStoreState, nextState);
      },
    },
  ),
}));

vi.mock('@/store/user/slices/settings/selectors/general', () => ({
  userGeneralSettingsSelectors: {
    generalInstruction: (state: typeof userStoreState) =>
      state.settings.general.generalInstruction,
  },
}));

describe('Chat Instruction settings', () => {
  beforeEach(() => {
    setSettings.mockReset();
    userStoreState.settings.general.generalInstruction = '# Be concise';
    setSettings.mockImplementation(async ({ general }: { general: { generalInstruction: string } }) => {
      userStoreState.settings.general.generalInstruction = general.generalInstruction;
    });
  });

  it('renders one full-width section and opens the inline editor', () => {
    render(<ChatInstruction />);

    expect(screen.getAllByText('chatInstruction.title')).toHaveLength(1);
    expect(screen.getByText('chatInstruction.desc')).not.toBeNull();
    expect(screen.getByTestId('instruction-preview').textContent).toBe('# Be concise');

    fireEvent.click(screen.getByRole('button', { name: 'common:edit' }));

    expect(screen.queryByText('chatInstruction.desc')).toBeNull();
    expect(
      (screen.getByRole('textbox', { name: 'instruction-editor' }) as HTMLTextAreaElement).value,
    ).toBe('# Be concise');
    expect(screen.getByRole('button', { name: 'common:cancel' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'common:ok' })).not.toBeNull();
  });

  it('persists confirmed Markdown changes', async () => {
    render(<ChatInstruction />);

    fireEvent.click(screen.getByRole('button', { name: 'common:edit' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'instruction-editor' }), {
      target: { value: '## Updated instruction' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'common:ok' }));

    expect(setSettings).toHaveBeenCalledOnce();
    expect(setSettings).toHaveBeenCalledWith(
      {
        general: { generalInstruction: '## Updated instruction' },
      },
      { skipRefresh: true },
    );
    await waitFor(() => {
      expect(screen.queryByRole('textbox', { name: 'instruction-editor' })).toBeNull();
    });
  });

  it('does not close a newer edit when an earlier save finishes', async () => {
    let resolveSave: (() => void) | undefined;
    setSettings.mockImplementationOnce(
      ({ general }: { general: { generalInstruction: string } }) => {
        userStoreState.settings.general.generalInstruction = general.generalInstruction;

        return new Promise<void>((resolve) => {
          resolveSave = resolve;
        });
      },
    );
    render(<ChatInstruction />);

    fireEvent.click(screen.getByRole('button', { name: 'common:edit' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'instruction-editor' }), {
      target: { value: '## Updated instruction' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'common:ok' }));

    expect(screen.queryByRole('textbox', { name: 'instruction-editor' })).toBeNull();
    expect(screen.getByTestId('instruction-preview').textContent).toBe('## Updated instruction');

    fireEvent.click(screen.getByRole('button', { name: 'common:edit' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'instruction-editor' }), {
      target: { value: '### Newer unsaved draft' },
    });

    await act(async () => {
      resolveSave?.();
    });

    expect(
      (screen.getByRole('textbox', { name: 'instruction-editor' }) as HTMLTextAreaElement).value,
    ).toBe('### Newer unsaved draft');
  });

  it('rolls back the optimistic instruction after a rejected save', async () => {
    setSettings.mockImplementationOnce(
      ({ general }: { general: { generalInstruction: string } }) => {
        userStoreState.settings.general.generalInstruction = general.generalInstruction;
        return Promise.reject(new Error('Network unavailable'));
      },
    );
    render(<ChatInstruction />);

    fireEvent.click(screen.getByRole('button', { name: 'common:edit' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'instruction-editor' }), {
      target: { value: '## Unsaved instruction' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'common:ok' }));

    await waitFor(() => {
      expect(screen.getByTestId('instruction-preview').textContent).toBe('# Be concise');
    });
  });

  it('keeps the confirmed instruction after a rejected save and remount', async () => {
    setSettings.mockImplementationOnce(
      ({ general }: { general: { generalInstruction: string } }) => {
        userStoreState.settings.general.generalInstruction = general.generalInstruction;
        return Promise.reject(new Error('Network unavailable'));
      },
    );
    const { unmount } = render(<ChatInstruction />);

    fireEvent.click(screen.getByRole('button', { name: 'common:edit' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'instruction-editor' }), {
      target: { value: '## Unsaved instruction' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'common:ok' }));

    await waitFor(() =>
      expect(screen.getByTestId('instruction-preview').textContent).toBe('# Be concise'),
    );
    unmount();
    render(<ChatInstruction />);
    expect(screen.getByTestId('instruction-preview').textContent).toBe('# Be concise');
  });

  it('consumes an abort from the current save without rolling back', async () => {
    setSettings.mockImplementationOnce(
      ({ general }: { general: { generalInstruction: string } }) => {
        userStoreState.settings.general.generalInstruction = general.generalInstruction;
        const abortError = new Error('canceled');
        abortError.name = 'AbortError';
        return Promise.reject(abortError);
      },
    );
    render(<ChatInstruction />);

    fireEvent.click(screen.getByRole('button', { name: 'common:edit' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'instruction-editor' }), {
      target: { value: '## Aborted instruction' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'common:ok' }));

    await waitFor(() => {
      expect(screen.getByTestId('instruction-preview').textContent).toBe(
        '## Aborted instruction',
      );
    });
  });

  it('consumes an aborted older save without rolling back the newer instruction', async () => {
    let rejectOlderSave: ((error: Error) => void) | undefined;
    setSettings
      .mockImplementationOnce(
        ({ general }: { general: { generalInstruction: string } }) => {
          userStoreState.settings.general.generalInstruction = general.generalInstruction;

          return new Promise<void>((_, reject) => {
            rejectOlderSave = reject;
          });
        },
      )
      .mockImplementationOnce(
        async ({ general }: { general: { generalInstruction: string } }) => {
          userStoreState.settings.general.generalInstruction = general.generalInstruction;
        },
      );
    render(<ChatInstruction />);

    fireEvent.click(screen.getByRole('button', { name: 'common:edit' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'instruction-editor' }), {
      target: { value: '## Older instruction' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'common:ok' }));

    fireEvent.click(screen.getByRole('button', { name: 'common:edit' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'instruction-editor' }), {
      target: { value: '## Newer instruction' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'common:ok' }));

    const abortError = new Error('canceled');
    abortError.name = 'AbortError';
    await act(async () => {
      rejectOlderSave?.(abortError);
    });

    expect(screen.getByTestId('instruction-preview').textContent).toBe(
      '## Newer instruction',
    );
  });

  it('reopens the editor with the newly saved instruction', async () => {
    render(<ChatInstruction />);

    fireEvent.click(screen.getByRole('button', { name: 'common:edit' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'instruction-editor' }), {
      target: { value: '## Updated instruction' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'common:ok' }));

    await waitFor(() => {
      expect(screen.queryByRole('textbox', { name: 'instruction-editor' })).toBeNull();
    });
    fireEvent.click(screen.getByRole('button', { name: 'common:edit' }));

    await waitFor(() => {
      expect(
        (screen.getByRole('textbox', { name: 'instruction-editor' }) as HTMLTextAreaElement)
          .value,
      ).toBe('## Updated instruction');
    });
  });

  it('discards canceled Markdown changes', () => {
    render(<ChatInstruction />);

    fireEvent.click(screen.getByRole('button', { name: 'common:edit' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'instruction-editor' }), {
      target: { value: 'Unsaved instruction' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'common:cancel' }));

    expect(setSettings).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'instruction-editor' })).toBeNull();
    expect(screen.getByTestId('instruction-preview').textContent).toBe('# Be concise');
    expect(screen.getByText('chatInstruction.desc')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'common:edit' }));
    expect(
      (screen.getByRole('textbox', { name: 'instruction-editor' }) as HTMLTextAreaElement).value,
    ).toBe('# Be concise');
  });

  it('keeps an empty instruction editable', () => {
    userStoreState.settings.general.generalInstruction = '';
    render(<ChatInstruction />);

    expect(screen.getByTestId('instruction-preview').textContent).toBe(
      'chatInstruction.placeholder',
    );

    expect(screen.queryByRole('button', { name: 'common:edit' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'empty-instruction-edit' }));

    expect(
      (screen.getByRole('textbox', { name: 'instruction-editor' }) as HTMLTextAreaElement).value,
    ).toBe('');
  });

  it('refreshes the preview when the stored instruction changes', () => {
    const { unmount } = render(<ChatInstruction />);

    userStoreState.settings.general.generalInstruction = '*Externally updated*';
    unmount();
    render(<ChatInstruction />);

    expect(screen.getByTestId('instruction-preview').textContent).toBe('*Externally updated*');
  });
});
