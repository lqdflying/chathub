import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Form } from 'antd';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import ProviderRouteToggle from './ProviderRouteToggle';

vi.stubGlobal('React', React);

const dir = dirname(fileURLToPath(import.meta.url));

const options = [
  { label: 'Chat Completions', value: 'chatCompletions' as const },
  { label: 'Responses API', value: 'responses' as const },
];

const RouteForm = ({
  disabled,
  onValuesChange,
}: {
  disabled?: boolean;
  onValuesChange?: (enableResponseApi: boolean) => void;
}) => {
  const [form] = Form.useForm();
  return (
    <Form
      form={form}
      initialValues={{ enableResponseApi: false }}
      onValuesChange={(_, values) => onValuesChange?.(Boolean(values.enableResponseApi))}
    >
      <Form.Item
        getValueFromEvent={(value: string) => value === 'responses'}
        getValueProps={(value?: boolean) => ({
          value: value ? 'responses' : 'chatCompletions',
        })}
        name="enableResponseApi"
      >
        <ProviderRouteToggle disabled={disabled} options={options} />
      </Form.Item>
    </Form>
  );
};

describe('ProviderRouteToggle', () => {
  it('uses a two-column grid and is not an antd block control', () => {
    const src = readFileSync(join(dir, 'ProviderRouteToggle.tsx'), 'utf8');

    expect(src).toContain('display: grid');
    expect(src).toContain('repeat(2, minmax(0, 1fr))');
    expect(src).toContain('role="radiogroup"');
    expect(src).toContain('role="radio"');
    expect(src).not.toContain('<Segmented');
    expect(src).not.toContain('<Radio');
  });

  it('moves Form selection with arrow keys and keeps a single tab stop', () => {
    const seen: boolean[] = [];
    render(<RouteForm onValuesChange={(value) => seen.push(value)} />);

    const chat = screen.getByRole('radio', { name: 'Chat Completions' });
    const responses = screen.getByRole('radio', { name: 'Responses API' });

    expect(chat.getAttribute('aria-checked')).toBe('true');
    expect(chat.getAttribute('tabindex')).toBe('0');
    expect(responses.getAttribute('tabindex')).toBe('-1');

    chat.focus();
    fireEvent.keyDown(chat, { key: 'ArrowRight' });

    expect(seen.at(-1)).toBe(true);
    expect(screen.getByRole('radio', { name: 'Responses API' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(screen.getByRole('radio', { name: 'Responses API' }).getAttribute('tabindex')).toBe('0');
    expect(screen.getByRole('radio', { name: 'Chat Completions' }).getAttribute('tabindex')).toBe(
      '-1',
    );
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Responses API' }));

    fireEvent.keyDown(screen.getByRole('radio', { name: 'Responses API' }), { key: 'ArrowRight' });
    expect(seen.at(-1)).toBe(false);
    expect(screen.getByRole('radio', { name: 'Chat Completions' }).getAttribute('aria-checked')).toBe(
      'true',
    );

    fireEvent.keyDown(screen.getByRole('radio', { name: 'Chat Completions' }), { key: 'ArrowLeft' });
    expect(seen.at(-1)).toBe(true);
  });

  it('does not change the Form value with arrows when disabled', () => {
    const seen: boolean[] = [];
    render(<RouteForm disabled onValuesChange={(value) => seen.push(value)} />);

    const chat = screen.getByRole('radio', { name: 'Chat Completions' });
    fireEvent.keyDown(chat, { key: 'ArrowRight' });
    expect(seen).toEqual([]);
    expect(chat.getAttribute('aria-checked')).toBe('true');
  });
});
