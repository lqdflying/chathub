import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { ResponseState } from '../types';
import ResponsePanel from './index';

vi.stubGlobal('React', React);

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({ onClick, title }: { onClick: () => void; title: string }) => (
    <button onClick={onClick} type="button">
      {title}
    </button>
  ),
  CopyButton: ({ content }: { content: string }) => (
    <button type="button">copy:{content}</button>
  ),
  Highlighter: ({ children }: { children: string }) => <pre>{children}</pre>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'apitest.downloadResponse': 'Download',
        'apitest.emptyBody': '(empty body)',
        'apitest.formatted': 'Formatted',
        'apitest.networkError': 'Network error',
        'apitest.raw': 'Raw',
        'apitest.responseBody': 'Body',
        'apitest.responseHeaders': 'Response Headers',
      })[key] ?? key,
  }),
}));

const makeResponse = (overrides: Partial<ResponseState>): ResponseState => ({
  body: '{"a":1}',
  headers: { 'content-type': 'application/json' },
  isJson: true,
  size: 7,
  status: 200,
  statusText: 'OK',
  time: 10,
  ...overrides,
});

describe('ResponsePanel', () => {
  it('resets headers tab and raw mode when a new response is rendered', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ResponsePanel response={makeResponse({})} />);

    await user.click(screen.getByRole('button', { name: 'Raw' }));
    expect(screen.getByText('{"a":1}')).toBeTruthy();

    await user.click(screen.getByRole('tab', { name: 'Response Headers (1)' }));
    expect(screen.getByText('content-type')).toBeTruthy();

    rerender(<ResponsePanel response={makeResponse({ body: '{"b":2}', size: 7, time: 10 })} />);

    expect(screen.getByRole('tab', { name: 'Body' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('button', { name: 'Raw' })).toBeTruthy();
    expect(screen.getAllByText(/"b": 2/)).toHaveLength(2);
  });
});
