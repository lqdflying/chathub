import { render } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ActionPopover from './ActionPopover';
import {
  MOBILE_ACTION_OVERLAY_ROOT_CLASS,
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
    styles: {
      mobileFixedRoot: 'mobileFixedRoot',
      mobileInner: 'mobileInner',
      mobileRoot: 'mobileRoot',
      popoverContent: 'popoverContent',
    },
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
    expect(String((lastPopoverProps?.classNames as { root?: string })?.root ?? '')).not.toContain(
      MOBILE_ACTION_OVERLAY_ROOT_CLASS,
    );
  });

  it('sizes the mobile overlay to max-content and keeps the gutter class', () => {
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

    expect(styles.root).toEqual(getMobileActionOverlayRootStyle(360));
    expect(styles.body?.maxWidth).toBeUndefined();
    expect(styles.body?.minWidth).toBeUndefined();
    expect(styles.body?.width).toBeUndefined();
    expect((lastPopoverProps?.classNames as { body?: string; root?: string })?.body).toContain(
      'mobileInner',
    );
    expect((lastPopoverProps?.classNames as { root?: string })?.root).toContain(
      MOBILE_ACTION_OVERLAY_ROOT_CLASS,
    );
    expect((lastPopoverProps?.classNames as { root?: string })?.root).toContain('mobileRoot');
    expect((lastPopoverProps?.classNames as { root?: string })?.root).not.toContain(
      'mobileFixedRoot',
    );
  });

  it('pins mobile fixedWidth overlays to the gutter-capped max width formula', () => {
    useIsMobile.mockReturnValue(true);

    render(
      <ActionPopover
        content="body"
        fixedWidth
        maxWidth={320}
        minWidth={320}
        title="fixed"
      >
        trigger
      </ActionPopover>,
    );

    const styles = lastPopoverProps?.styles as {
      body?: Record<string, unknown>;
      root?: Record<string, unknown>;
    };
    const rootClass = String((lastPopoverProps?.classNames as { root?: string })?.root ?? '');

    expect(styles.root).toEqual(getMobileActionOverlayRootStyle(320));
    expect(styles.body?.minWidth).toBeUndefined();
    expect(rootClass).toContain(MOBILE_ACTION_OVERLAY_ROOT_CLASS);
    expect(rootClass).toContain('mobileFixedRoot');
    expect(rootClass).not.toContain('mobileRoot');
  });

  it('forwards non-positional caller root styles and keeps the non-overridable gutter class', () => {
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

    expect(styles.root).toMatchObject({ zIndex: 42 });
    expect((lastPopoverProps?.classNames as { root?: string })?.root).toContain(
      MOBILE_ACTION_OVERLAY_ROOT_CLASS,
    );
    expect((lastPopoverProps?.classNames as { root?: string })?.root).toContain('mobileRoot');
  });
});
