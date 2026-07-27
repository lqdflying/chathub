import { fireEvent, render, screen } from '@testing-library/react';
import { gptImage2CompatibleParamsSchema } from 'model-bank';
import React, { type ChangeEvent, type PropsWithChildren } from 'react';
import { describe, expect, it, vi } from 'vitest';

import SizeSelect from './index';

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({ icon: _icon, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props} />
  ),
  Alert: ({ message }: { message: React.ReactNode }) => <div role="alert">{message}</div>,
  Block: ({
    children,
    clickable: _clickable,
    shadow: _shadow,
    variant: _variant,
    ...props
  }: PropsWithChildren<Record<string, unknown>>) => <div {...props}>{children}</div>,
  Grid: ({ children }: PropsWithChildren) => <div>{children}</div>,
  InputNumber: ({
    onChange,
    onPressEnter,
    ...props
  }: {
    onChange?: (value: number | null) => void;
    onPressEnter?: () => void;
  } & React.InputHTMLAttributes<HTMLInputElement>) => (
    <input
      type="number"
      {...props}
      onChange={(event: ChangeEvent<HTMLInputElement>) =>
        onChange?.(event.target.value === '' ? null : Number(event.target.value))
      }
      onKeyDown={(event) => {
        props.onKeyDown?.(event);
        if (event.key === 'Enter') onPressEnter?.();
      }}
    />
  ),
  Select: ({ options, value }: { options: Array<{ value: string }>; value: string }) => (
    <select data-testid="fallback-select" value={value}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.value}
        </option>
      ))}
    </select>
  ),
  Text: ({ children, ...props }: PropsWithChildren) => <span {...props}>{children}</span>,
}));

vi.mock('antd-style', () => ({
  createStyles: () => () => ({
    cx: (...classNames: Array<string | false | undefined>) => classNames.filter(Boolean).join(' '),
    styles: {
      actionButton: 'actionButton',
      customActions: 'customActions',
      customEditor: 'customEditor',
      customInput: 'customInput',
      customInputs: 'customInputs',
      error: 'error',
      group: 'group',
      groupGrid: 'groupGrid',
      groupLabel: 'groupLabel',
      inputLabel: 'inputLabel',
      option: 'option',
      optionActive: 'optionActive',
      optionLabel: 'optionLabel',
      optionValue: 'optionValue',
      tieredContainer: 'tieredContainer',
      warning: 'warning',
    },
  }),
  useTheme: () => ({
    colorBgElevated: '#fff',
    colorText: '#111',
    colorTextDescription: '#777',
    isDarkMode: false,
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('react-layout-kit', () => ({
  Center: ({ children }: PropsWithChildren) => <div>{children}</div>,
  Flexbox: ({ children, horizontal: _horizontal, ...props }: PropsWithChildren<Record<string, unknown>>) => (
    <div {...props}>{children}</div>
  ),
}));

const gptImage2Options = gptImage2CompatibleParamsSchema.size!.enum.map((size) => ({
  label: size,
  value: size,
}));

describe('SizeSelect', () => {
  it('renders the GPT Image 2 tier matrix with exact dimensions', () => {
    render(
      <SizeSelect
        defaultValue="auto"
        options={gptImage2Options}
        sizeSchema={gptImage2CompatibleParamsSchema.size}
      />,
    );

    expect(screen.getByText('config.size.tiers.standard')).toBeTruthy();
    expect(screen.getByText('config.size.tiers.2k')).toBeTruthy();
    expect(screen.getByText('config.size.tiers.4k')).toBeTruthy();
    expect(screen.getAllByText('config.size.tiers.custom')).toHaveLength(1);

    for (const size of [
      '1024x1024',
      '1536x1024',
      '1024x1536',
      '2560x1440',
      '1440x2560',
      '3840x2160',
      '2160x3840',
    ]) {
      expect(screen.getByText(size)).toBeTruthy();
    }

    expect(screen.getAllByText('config.size.orientation.square')).toHaveLength(1);
    expect(screen.getAllByText('config.size.orientation.landscape')).toHaveLength(3);
    expect(screen.getAllByText('config.size.orientation.portrait')).toHaveLength(3);
    expect(document.querySelectorAll('.groupGrid').length).toBeGreaterThanOrEqual(5);
  });

  it('warns for 4K presets but not the 2K boundary', () => {
    const onChange = vi.fn();
    render(
      <SizeSelect
        defaultValue="auto"
        onChange={onChange}
        options={gptImage2Options}
        sizeSchema={gptImage2CompatibleParamsSchema.size}
      />,
    );

    fireEvent.click(screen.getByText('2560x1440').closest('button')!);
    expect(onChange).toHaveBeenLastCalledWith('2560x1440');
    expect(screen.queryByRole('alert')).toBeNull();

    fireEvent.click(screen.getByText('3840x2160').closest('button')!);
    expect(onChange).toHaveBeenLastCalledWith('3840x2160');
    expect(screen.getByRole('alert').textContent).toBe('config.size.experimentalWarning');
  });

  it('commits a valid custom size and displays its experimental warning', () => {
    const onChange = vi.fn();
    render(
      <SizeSelect
        defaultValue="auto"
        onChange={onChange}
        options={gptImage2Options}
        sizeSchema={gptImage2CompatibleParamsSchema.size}
      />,
    );

    fireEvent.click(screen.getByText('config.size.custom').closest('button')!);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'config.width.label' }), {
      target: { value: '2048' },
    });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'config.height.label' }), {
      target: { value: '2048' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'config.size.confirm' }));

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith('2048x2048');
    expect(screen.queryByRole('spinbutton', { name: 'config.width.label' })).toBeNull();
    expect(screen.getByRole('alert').textContent).toBe('config.size.experimentalWarning');
  });

  it.each([
    ['', '1024', 'required'],
    ['1024.5', '1024', 'format'],
    ['3856', '2160', 'maxEdge'],
    ['1025', '1024', 'multiple'],
    ['3088', '1024', 'aspectRatio'],
    ['800', '800', 'minPixels'],
    ['3840', '2176', 'maxPixels'],
  ])(
    'keeps invalid custom size %sx%s out of state and reports %s',
    (width, height, expectedError) => {
      const onChange = vi.fn();
      render(
        <SizeSelect
          defaultValue="auto"
          onChange={onChange}
          options={gptImage2Options}
          sizeSchema={gptImage2CompatibleParamsSchema.size}
        />,
      );

      fireEvent.click(screen.getByText('config.size.custom').closest('button')!);
      fireEvent.change(screen.getByRole('spinbutton', { name: 'config.width.label' }), {
        target: { value: width },
      });
      fireEvent.change(screen.getByRole('spinbutton', { name: 'config.height.label' }), {
        target: { value: height },
      });

      expect(screen.getByText(`config.size.errors.${expectedError}`)).toBeTruthy();
      expect(
        (screen.getByRole('button', { name: 'config.size.confirm' }) as HTMLButtonElement).disabled,
      ).toBe(true);
      expect(onChange).not.toHaveBeenCalled();
    },
  );

  it('confirms valid custom dimensions with Enter', () => {
    const onChange = vi.fn();
    render(
      <SizeSelect
        defaultValue="auto"
        onChange={onChange}
        options={gptImage2Options}
        sizeSchema={gptImage2CompatibleParamsSchema.size}
      />,
    );

    fireEvent.click(screen.getByText('config.size.custom').closest('button')!);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'config.width.label' }), {
      target: { value: '2048' },
    });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'config.height.label' }), {
      target: { value: '1536' },
    });
    fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'config.height.label' }), {
      key: 'Enter',
    });

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith('2048x1536');
  });

  it('cancels custom edits without changing the selected size', () => {
    const onChange = vi.fn();
    render(
      <SizeSelect
        defaultValue="1024x1024"
        onChange={onChange}
        options={gptImage2Options}
        sizeSchema={gptImage2CompatibleParamsSchema.size}
      />,
    );

    fireEvent.click(screen.getByText('config.size.custom').closest('button')!);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'config.width.label' }), {
      target: { value: '2048' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'config.size.cancel' }));

    expect(screen.queryByRole('spinbutton', { name: 'config.width.label' })).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('cancels custom edits with Escape without changing the selected size', () => {
    const onChange = vi.fn();
    render(
      <SizeSelect
        defaultValue="1024x1024"
        onChange={onChange}
        options={gptImage2Options}
        sizeSchema={gptImage2CompatibleParamsSchema.size}
      />,
    );

    fireEvent.click(screen.getByText('config.size.custom').closest('button')!);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'config.width.label' }), {
      target: { value: '2048' },
    });
    fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'config.width.label' }), {
      key: 'Escape',
    });

    expect(screen.queryByRole('spinbutton', { name: 'config.width.label' })).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('preserves the fixed-enum selector when custom metadata is absent', () => {
    render(
      <SizeSelect
        defaultValue="auto"
        options={[
          { label: 'Auto', value: 'auto' },
          { label: 'Square', value: '1024x1024' },
        ]}
        sizeSchema={{ default: 'auto', enum: ['auto', '1024x1024'] }}
      />,
    );

    expect(screen.getByText('Square')).toBeTruthy();
    expect(screen.queryByText('config.size.tiers.custom')).toBeNull();
  });

  it('preserves the select fallback for non-dimension fixed enums', () => {
    render(
      <SizeSelect
        defaultValue="small"
        options={[
          { label: 'Small', value: 'small' },
          { label: 'Large', value: 'large' },
        ]}
        sizeSchema={{ default: 'small', enum: ['small', 'large'] }}
      />,
    );

    expect(screen.getByTestId('fallback-select')).toBeTruthy();
    expect(screen.queryByText('config.size.tiers.custom')).toBeNull();
  });
});
