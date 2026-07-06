import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from 'antd';
import { describe, expect, it, vi } from 'vitest';

import MarkdownTable from './index';

const copyToClipboard = vi.fn();
const messageSuccess = vi.fn();

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({ icon: Icon, title, ...props }: any) => (
    <button aria-label={title} type="button" {...props}>
      {Icon ? <Icon aria-hidden="true" size={12} /> : null}
    </button>
  ),
  copyToClipboard: (...args: any[]) => copyToClipboard(...args),
}));

vi.mock('antd', () => ({
  App: {
    useApp: vi.fn(() => ({ message: { success: messageSuccess } })),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'MarkdownTable.copyAsCsv': 'Copy as CSV',
        'MarkdownTable.copyAsMarkdown': 'Copy as Markdown',
        'MarkdownTable.copySuccess': 'Table copied',
      })[key] || key,
  }),
}));

describe('MarkdownTable', () => {
  it('renders a labeled toolbar for table copy actions', () => {
    render(
      <MarkdownTable>
        <thead>
          <tr>
            <th>Name</th>
          </tr>
        </thead>
      </MarkdownTable>,
    );

    expect(App.useApp).toHaveBeenCalled();
    expect(screen.getByRole('toolbar', { name: 'Copy as Markdown / Copy as CSV' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy as Markdown' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy as CSV' })).toBeTruthy();
  });

  it('copies rendered table content as Markdown and CSV', async () => {
    const user = userEvent.setup();

    render(
      <MarkdownTable>
        <thead>
          <tr>
            <th>Name</th>
            <th>Age</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Alice</td>
            <td>30</td>
          </tr>
        </tbody>
      </MarkdownTable>,
    );

    await user.click(screen.getByRole('button', { name: 'Copy as Markdown' }));
    expect(copyToClipboard).toHaveBeenLastCalledWith('| Name | Age |\n| --- | --- |\n| Alice | 30 |');
    expect(messageSuccess).toHaveBeenLastCalledWith('Table copied');

    await user.click(screen.getByRole('button', { name: 'Copy as CSV' }));
    expect(copyToClipboard).toHaveBeenLastCalledWith('Name,Age\nAlice,30');
    expect(messageSuccess).toHaveBeenCalledTimes(2);
  });
});
