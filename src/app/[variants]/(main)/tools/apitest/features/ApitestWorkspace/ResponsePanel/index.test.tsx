import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { JSON_TREE_MAX_NODES } from '../constants';
import type { ResponseState } from '../types';
import ResponsePanel from './index';

vi.stubGlobal('React', React);

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({ onClick, title }: { onClick: () => void; title: string }) => (
    <button onClick={onClick} type="button">
      {title}
    </button>
  ),
  CopyButton: ({ content }: { content: string }) => <button type="button">copy:{content}</button>,
  Highlighter: ({ children }: { children: string }) => <pre>{children}</pre>,
}));

vi.mock('./JsonTree', () => ({
  default: ({
    accessibleLabel,
    data,
  }: {
    accessibleLabel: string;
    data: { root: { key: string } };
  }) => (
    <div aria-label={accessibleLabel} role="tree">
      tree:{data.root.key}
    </div>
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'apitest.downloadResponse': 'Download',
        'apitest.emptyBody': '(empty body)',
        'apitest.formatted': 'Formatted',
        'apitest.jsonTree': 'Tree',
        'apitest.jsonTreeLabel': 'JSON response tree',
        'apitest.jsonTreeTooLarge':
          'This JSON response is too large for Tree view. Use Formatted or Raw view instead.',
        'apitest.networkError': 'Network error',
        'apitest.raw': 'Raw',
        'apitest.responseBody': 'Response Body',
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

const getCopyContent = (): string | null | undefined =>
  screen
    .getAllByRole('button')
    .find((button) => button.textContent?.startsWith('copy:'))
    ?.textContent?.slice('copy:'.length);

describe('ResponsePanel', () => {
  const createObjectUrl = vi.fn(() => 'blob:response');
  const revokeObjectUrl = vi.fn();
  const anchorClick = vi.fn();
  let createElementSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubGlobal('URL', {
      createObjectURL: createObjectUrl,
      revokeObjectURL: revokeObjectUrl,
    });
    const originalCreateElement = document.createElement.bind(document);
    createElementSpy = vi
      .spyOn(document, 'createElement')
      .mockImplementation((tagName, options) => {
        const element = originalCreateElement(tagName, options);
        if (tagName === 'a') element.click = anchorClick;
        return element;
      });
  });

  afterEach(() => {
    createElementSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.stubGlobal('React', React);
  });

  it('defaults valid JSON to Tree and resets the response tab and view for a new response', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ResponsePanel response={makeResponse({})} />);

    expect(screen.getByRole('tab', { name: 'Response Body' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByRole('tree', { name: 'JSON response tree' })).toBeTruthy();

    await user.click(screen.getByText('Raw'));
    expect(screen.getByText('{"a":1}')).toBeTruthy();

    await user.click(screen.getByRole('tab', { name: 'Response Headers (1)' }));
    expect(screen.getByText('content-type')).toBeTruthy();

    rerender(<ResponsePanel response={makeResponse({ body: '{"b":2}', size: 7, time: 10 })} />);

    expect(screen.getByRole('tab', { name: 'Response Body' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByRole('tree', { name: 'JSON response tree' })).toBeTruthy();
    expect(getCopyContent()).toBe('{\n  "b": 2\n}');
  });

  it('copies formatted JSON in Tree and Formatted modes and exact JSON in Raw mode', async () => {
    const user = userEvent.setup();
    render(<ResponsePanel response={makeResponse({ body: '{"value":1}' })} />);

    expect(getCopyContent()).toBe('{\n  "value": 1\n}');

    await user.click(screen.getByText('Formatted'));
    expect(getCopyContent()).toBe('{\n  "value": 1\n}');

    await user.click(screen.getByText('Raw'));
    expect(getCopyContent()).toBe('{"value":1}');
  });

  it('downloads the exact original body from every response view', async () => {
    const user = userEvent.setup();
    render(<ResponsePanel response={makeResponse({ body: '{"value":1}' })} />);

    await user.click(screen.getByRole('button', { name: 'Download' }));

    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    const blob = createObjectUrl.mock.calls[0][0] as Blob;
    expect(await blob.text()).toBe('{"value":1}');
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:response');
  });

  it('keeps malformed and non-JSON responses in text views', () => {
    const { rerender } = render(
      <ResponsePanel response={makeResponse({ body: '{"unfinished":', isJson: true })} />,
    );

    expect(screen.queryByText('Tree')).toBeNull();
    expect(screen.getByText('{"unfinished":')).toBeTruthy();

    rerender(
      <ResponsePanel
        response={makeResponse({
          body: 'plain text',
          headers: { 'content-type': 'text/plain' },
          isJson: false,
        })}
      />,
    );

    expect(screen.queryByText('Tree')).toBeNull();
    expect(screen.getByText('plain text')).toBeTruthy();
  });

  it('falls back to text views and explains when JSON exceeds the tree budget', () => {
    const oversizedBody = JSON.stringify(
      Array.from({ length: JSON_TREE_MAX_NODES }, (_, index) => index),
    );
    render(<ResponsePanel response={makeResponse({ body: oversizedBody })} />);

    expect(screen.queryByText('Tree')).toBeNull();
    expect(
      screen.getByText(
        'This JSON response is too large for Tree view. Use Formatted or Raw view instead.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Formatted')).toBeTruthy();
    expect(screen.getByText('Raw')).toBeTruthy();
  });

  it('names the segmented options as one keyboard-operable radio group', () => {
    render(<ResponsePanel response={makeResponse({})} />);

    const rawOption = screen.getByRole('radio', { name: 'Raw' });
    expect(rawOption.getAttribute('name')).toBe('api-tester-response-view');
  });
});
