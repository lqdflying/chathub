import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import HistoryDrawer from './HistoryDrawer';
import type { ApiTesterHistoryEntry } from './history';
import { createEmptyDraft } from './types';

vi.stubGlobal('React', React);

vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd')>();
  return {
    ...actual,
    Drawer: ({ children, extra, open, title }: any) =>
      open ? (
        <section aria-label={title}>
          {extra}
          {children}
        </section>
      ) : null,
    Popconfirm: ({ cancelText, children, okButtonProps, okText, onConfirm, title }: any) => (
      <div data-cancel-text={cancelText} data-ok-danger={String(!!okButtonProps?.danger)} data-ok-text={okText}>
        <span>{title}</span>
        {children}
        <button onClick={onConfirm} type="button">
          confirm-clear
        </button>
      </div>
    ),
    Tooltip: ({ children }: any) => children,
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) =>
      ({
        'apitest.cancel': 'Cancel',
        'apitest.clearHistory': 'Clear All',
        'apitest.clearHistoryConfirm': 'Clear all history?',
        'apitest.deleteHistoryEntry': 'Delete history entry',
        'apitest.history': 'History',
        'apitest.historyEmpty': 'No requests yet',
        'apitest.restore': 'Click to restore',
        'apitest.restoreHistoryEntry': `Restore ${options?.method} request to ${options?.url}`,
      })[key] ?? key,
  }),
}));

const entry: ApiTesterHistoryEntry = {
  createdAt: 1_700_000_000_000,
  id: 'entry-1',
  request: {
    ...createEmptyDraft(),
    method: 'GET',
    url: 'https://example.com/users',
  },
  response: { size: 12, status: 200, time: 34 },
};

describe('HistoryDrawer', () => {
  it('restores entries with keyboard activation and deletes from a separate button', async () => {
    const user = userEvent.setup();
    const onRestore = vi.fn();
    const onDelete = vi.fn();

    render(
      <HistoryDrawer
        entries={[entry]}
        onClear={vi.fn()}
        onClose={vi.fn()}
        onDelete={onDelete}
        onRestore={onRestore}
        open
      />,
    );

    const restoreButton = screen.getByRole('button', {
      name: 'Restore GET request to https://example.com/users',
    });
    restoreButton.focus();
    await user.keyboard('{Enter}');
    expect(onRestore).toHaveBeenCalledWith(entry);

    await user.click(screen.getByRole('button', { name: 'Delete history entry' }));
    expect(onDelete).toHaveBeenCalledWith('entry-1');
  });

  it('uses localized clear-history confirmation actions', () => {
    const onClear = vi.fn();

    render(
      <HistoryDrawer
        entries={[entry]}
        onClear={onClear}
        onClose={vi.fn()}
        onDelete={vi.fn()}
        onRestore={vi.fn()}
        open
      />,
    );

    const confirm = screen.getByText('Clear all history?').parentElement!;
    expect(confirm.getAttribute('data-ok-text')).toBe('Clear All');
    expect(confirm.getAttribute('data-cancel-text')).toBe('Cancel');
    expect(confirm.getAttribute('data-ok-danger')).toBe('true');
  });
});
