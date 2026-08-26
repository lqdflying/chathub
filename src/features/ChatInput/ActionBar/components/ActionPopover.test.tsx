import { render } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ActionPopover from './ActionPopover';
import { getMobileActionOverlayBoxStyle, getMobileActionOverlayMaxWidth } from './mobileOverlayWidth';

vi.stubGlobal('React', React);

const { useIsMobile } = vi.hoisted(() => ({
  useIsMobile: vi.fn(() => false),
}));

let lastPopoverProps: Record<string, unknown> | undefined;

vi.mock('@/hooks/useIsMobile', () => ({
  useIsMobile,
}));

vi.mock('@/components/Loading/UpdateLoading', () => ({
  default: () => null,
}));

vi.mock('antd-style', () => ({
  createStyles: () => () => ({
    cx: (...args: Array<string | undefined>) => args.filter(Boolean).join(' '),
    styles: { popoverContent: 'popoverContent' },
    theme: { colorTextSecondary: '#888' },
  }),
}));

vi.mock('antd', () => ({
  Popover: (props: Record<string, unknown>) => {
    lastPopoverProps = props;
    return <div>{props.children as never}</div>;
  },
}));

describe('ActionPopover mobile overlay width', () => {
  beforeEach(() => {
    lastPopoverProps = undefined;
    useIsMobile.mockReturnValue(false);
  });

  it('keeps desktop minWidth and maxWidth and does not force 100vw', () => {
    render(
      <ActionPopover content="body" maxWidth={360} minWidth={240} title="desktop">
        trigger
      </ActionPopover>,
    );

    const styles = lastPopoverProps?.styles as {
      body?: { maxWidth?: number; minWidth?: number; width?: string };
      root?: { maxWidth?: string };
    };

    expect(styles.body).toMatchObject({ maxWidth: 360, minWidth: 240 });
    expect(styles.body?.width).toBeUndefined();
    expect(styles.root?.maxWidth).toBeUndefined();
  });

  it('caps the overlay to the viewport minus 16px gutters on mobile', () => {
    useIsMobile.mockReturnValue(true);

    render(
      <ActionPopover content="body" maxWidth={360} minWidth={240} title="mobile">
        trigger
      </ActionPopover>,
    );

    const styles = lastPopoverProps?.styles as {
      body?: Record<string, unknown>;
      root?: { maxWidth?: string };
    };

    expect(styles.body).toMatchObject(getMobileActionOverlayBoxStyle());
    expect(styles.body?.minWidth).toBeUndefined();
    expect(styles.body?.width).toBe(getMobileActionOverlayMaxWidth());
    expect(styles.body?.width).not.toBe('100vw');
    expect(styles.root?.maxWidth).toBe(getMobileActionOverlayMaxWidth());
  });
});
