import { render } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ActionPopover from './ActionPopover';
import {
  getMobileActionOverlayInnerStyle,
  getMobileActionOverlayRootStyle,
} from './mobileOverlayWidth';

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

  it('keeps desktop minWidth and maxWidth and does not pin the root', () => {
    render(
      <ActionPopover content="body" maxWidth={360} minWidth={240} title="desktop">
        trigger
      </ActionPopover>,
    );

    const styles = lastPopoverProps?.styles as {
      body?: { maxWidth?: number; minWidth?: number; width?: string };
      root?: { left?: number; maxWidth?: string; width?: string };
    };

    expect(styles.body).toMatchObject({ maxWidth: 360, minWidth: 240 });
    expect(styles.body?.width).toBeUndefined();
    expect(styles.root?.left).toBeUndefined();
    expect(styles.root?.width).toBeUndefined();
  });

  it('pins the mobile overlay root to 16px gutters instead of only shrinking it', () => {
    useIsMobile.mockReturnValue(true);

    render(
      <ActionPopover content="body" maxWidth={360} minWidth={240} title="mobile">
        trigger
      </ActionPopover>,
    );

    const styles = lastPopoverProps?.styles as {
      body?: Record<string, unknown>;
      root?: Record<string, unknown>;
    };

    expect(styles.root).toMatchObject(getMobileActionOverlayRootStyle());
    expect(styles.body).toMatchObject(getMobileActionOverlayInnerStyle());
    expect(styles.body?.minWidth).toBeUndefined();
    expect(styles.body?.width).toBe('100%');
    expect(styles.body?.width).not.toBe('100vw');
    expect(styles.root?.width).toBe('auto');
  });

  it('lets caller root styles override the mobile gutter pin', () => {
    useIsMobile.mockReturnValue(true);

    render(
      <ActionPopover
        content="body"
        styles={{ root: { left: 8, zIndex: 42 } }}
        title="override"
      >
        trigger
      </ActionPopover>,
    );

    const styles = lastPopoverProps?.styles as { root?: Record<string, unknown> };

    expect(styles.root).toMatchObject({ left: 8, right: 16, width: 'auto', zIndex: 42 });
  });
});
