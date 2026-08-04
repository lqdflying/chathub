import { act, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import HousekeepingDialog from './HousekeepingDialog';

vi.stubGlobal('React', React);

const { housekeep, message, previewHousekeeping } = vi.hoisted(() => ({
  housekeep: vi.fn(),
  message: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
  previewHousekeeping: vi.fn(),
}));

vi.mock('@/store/image', () => ({
  useImageStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      housekeepGenerationTopics: housekeep,
      previewGenerationTopicHousekeeping: previewHousekeeping,
    }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({ 'aria-label': ariaLabel, title }: { 'aria-label': string; 'title': string }) => (
    <button aria-label={ariaLabel} title={title} type={'button'} />
  ),
}));

vi.mock('react-layout-kit', () => ({
  Flexbox: ({
    align: _align,
    children,
    gap: _gap,
    horizontal: _horizontal,
    minHeight: _minHeight,
    paddingBlock: _paddingBlock,
    width: _width,
    ...props
  }: React.HTMLAttributes<HTMLDivElement> & Record<string, unknown>) => (
    <div {...props}>{children}</div>
  ),
}));

vi.mock('antd', async () => {
  const React = await import('react');

  return {
    App: { useApp: () => ({ message }) },
    Button: ({
      children,
      danger,
      loading,
      size: _size,
      style,
      type: _type,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
      danger?: boolean;
      loading?: boolean;
    }) => (
      <button
        data-danger={String(Boolean(danger))}
        data-flex={String(style?.flex)}
        data-loading={String(Boolean(loading))}
        data-min-height={String(style?.minHeight)}
        style={style}
        type={'button'}
        {...props}
      >
        {children}
      </button>
    ),
    InputNumber: ({
      onChange,
      status: _status,
      value,
      ...props
    }: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> & {
      onChange: (value: number | null) => void;
      status?: string;
      value: number | null;
    }) => (
      <input
        {...props}
        onChange={(event) =>
          onChange(event.target.value === '' ? null : Number(event.target.value))
        }
        type={'number'}
        value={value ?? ''}
      />
    ),
    Modal: ({
      children,
      footer,
      open,
      title,
    }: {
      children: React.ReactNode;
      footer: React.ReactNode;
      open: boolean;
      title: React.ReactNode;
    }) =>
      open ? (
        <div role={'dialog'}>
          <div>{title}</div>
          {children}
          <div data-testid={'modal-footer'}>{footer}</div>
        </div>
      ) : null,
    Popover: ({
      children,
      content,
      title,
    }: {
      children: React.ReactNode;
      content: React.ReactNode;
      title: React.ReactNode;
    }) => {
      const [open, setOpen] = React.useState(false);

      return (
        <div onClick={() => setOpen(true)}>
          {children}
          {open && (
            <div role={'note'}>
              <strong>{title}</strong>
              <span>{content}</span>
            </div>
          )}
        </div>
      );
    },
    Segmented: ({
      onChange,
      options,
      value,
    }: {
      onChange: (value: string | number) => void;
      options: { label: React.ReactNode; value: string | number }[];
      value: string | number;
    }) => (
      <div role={'radiogroup'}>
        {options.map((option) => (
          <button
            aria-pressed={option.value === value}
            key={option.value}
            onClick={() => onChange(option.value)}
            type={'button'}
          >
            {option.label}
          </button>
        ))}
      </div>
    ),
    Spin: () => <span>loading</span>,
    Typography: {
      Text: ({
        children,
        strong: _strong,
        type: _type,
        ...props
      }: React.HTMLAttributes<HTMLSpanElement> & { strong?: boolean; type?: string }) => (
        <span {...props}>{children}</span>
      ),
    },
  };
});

const flushPreview = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250);
  });
};

describe('HousekeepingDialog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    previewHousekeeping.mockReset().mockResolvedValue({
      deletableTopicCount: 2,
      skippedActiveTopicCount: 0,
    });
    housekeep.mockReset().mockResolvedValue({
      deletedTopicIds: ['topic-a', 'topic-b'],
      skippedActiveTopicCount: 0,
    });
    message.error.mockReset();
    message.success.mockReset();
    message.warning.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ['topic.housekeeping.oneDay', 1],
    ['topic.housekeeping.sevenDays', 7],
    ['topic.housekeeping.thirtyDays', 30],
  ])('previews the %s preset', async (label, days) => {
    render(<HousekeepingDialog onClose={vi.fn()} open />);

    fireEvent.click(screen.getByText(label));
    await flushPreview();

    expect(previewHousekeeping).toHaveBeenLastCalledWith({ days, mode: 'olderThan' });
  });

  it('validates a custom day count before previewing or deleting', async () => {
    render(<HousekeepingDialog onClose={vi.fn()} open />);
    await flushPreview();

    fireEvent.click(screen.getByText('topic.housekeeping.custom'));
    const input = screen.getByLabelText('topic.housekeeping.customDays');
    const deleteButton = screen.getByText('topic.housekeeping.confirm');

    fireEvent.change(input, { target: { value: '' } });

    expect(screen.getByRole('alert').textContent).toBe('topic.housekeeping.customDaysInvalid');
    expect((deleteButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(input, { target: { value: '45' } });
    await flushPreview();

    expect(previewHousekeeping).toHaveBeenLastCalledWith({ days: 45, mode: 'olderThan' });
    expect((deleteButton as HTMLButtonElement).disabled).toBe(false);
  });

  it('submits all-history mode without an age cutoff', async () => {
    render(<HousekeepingDialog onClose={vi.fn()} open />);

    fireEvent.click(screen.getByText('topic.housekeeping.all'));
    await flushPreview();
    fireEvent.click(screen.getByText('topic.housekeeping.confirm'));

    await act(async () => {});

    expect(previewHousekeeping).toHaveBeenLastCalledWith({ mode: 'all' });
    expect(housekeep).toHaveBeenCalledWith({ mode: 'all' });
    expect(screen.queryByLabelText('topic.housekeeping.customDays')).toBeNull();
  });

  it('keeps explanatory copy behind help and renders two balanced actions', async () => {
    render(<HousekeepingDialog onClose={vi.fn()} open />);
    await flushPreview();

    expect(screen.queryByText('topic.housekeeping.notice')).toBeNull();
    fireEvent.click(screen.getByLabelText('topic.housekeeping.help'));
    expect(screen.getByText('topic.housekeeping.notice')).toBeTruthy();

    const footer = screen.getByTestId('modal-footer');
    const footerButtons = within(footer).getAllByRole('button');

    expect(footerButtons).toHaveLength(2);
    for (const button of footerButtons) {
      expect(button.dataset.flex).toBe('1');
      expect(button.dataset.minHeight).toBe('44');
    }
  });
});
