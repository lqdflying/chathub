import { render, waitFor } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import { ThemeProvider } from 'antd-style';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ActionDropdown from './ActionDropdown';
import ActionPopover from './ActionPopover';
import {
  MOBILE_ACTION_OVERLAY_GUTTER_PX,
  MOBILE_ACTION_OVERLAY_MAX_VAR,
  MOBILE_ACTION_OVERLAY_ROOT_CLASS,
} from './mobileOverlayWidth';

vi.stubGlobal('React', React);

const { useIsMobile } = vi.hoisted(() => ({
  useIsMobile: vi.fn(() => true),
}));

vi.mock('@/hooks/useIsMobile', () => ({
  useIsMobile,
}));

vi.mock('@/components/Loading/UpdateLoading', () => ({
  default: () => null,
}));

const VIEWPORT_WIDTH = 375;

const menu = { items: [{ key: 'one', label: 'One' }] };

const renderOverlay = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

const injectedStylesheetText = () =>
  Array.from(document.querySelectorAll('style'))
    .map((node) => node.textContent ?? '')
    .join('\n')
    .replace(/\s+/g, '');

const assertContentSizedWithGutters = (root: HTMLElement) => {
  expect(root.className).toContain(MOBILE_ACTION_OVERLAY_ROOT_CLASS);

  // rc-trigger useAlign writes left after React commit; the stylesheet must still win.
  root.style.left = '0px';

  const css = injectedStylesheetText();
  expect(css).toContain('left:50%!important');
  expect(css).toContain('right:auto!important');
  expect(css).toContain('width:max-content!important');
  expect(css).toContain(`var(${MOBILE_ACTION_OVERLAY_MAX_VAR},100vw)`);
  expect(css).toContain('translate:-50%');
  expect(css).not.toContain('transform:translateX(-50%)!important');
  expect(css).not.toContain('max-width:100%!important');

  const rect = root.getBoundingClientRect();
  if (rect.width > 0) {
    expect(rect.width).toBeLessThan(VIEWPORT_WIDTH - MOBILE_ACTION_OVERLAY_GUTTER_PX * 2);
    expect(rect.left).toBeGreaterThanOrEqual(MOBILE_ACTION_OVERLAY_GUTTER_PX);
    expect(VIEWPORT_WIDTH - rect.right).toBeGreaterThanOrEqual(MOBILE_ACTION_OVERLAY_GUTTER_PX);
  }
};

const Trigger = ({ side }: { side: 'left' | 'right' }) => (
  <button
    style={{
      position: 'absolute',
      [side]: 8,
      top: 240,
    }}
    type="button"
  >
    {side}
  </button>
);

describe('mobile action overlay placement', () => {
  beforeEach(() => {
    useIsMobile.mockReturnValue(true);
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: VIEWPORT_WIDTH });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 667 });
  });

  it.each(['left', 'right'] as const)(
    'keeps ActionPopover 16px from both viewport edges when the trigger is near the %s',
    async (side) => {
      renderOverlay(
        <div style={{ height: 400, position: 'relative', width: VIEWPORT_WIDTH }}>
          <ActionPopover content="panel" getPopupContainer={() => document.body} open title="t">
            <Trigger side={side} />
          </ActionPopover>
        </div>,
      );

      const root = await waitFor(() => {
        const node = document.querySelector('.ant-popover') as HTMLElement | null;
        expect(node).toBeTruthy();
        return node!;
      });

      assertContentSizedWithGutters(root);
    },
  );

  it.each(['left', 'right'] as const)(
    'keeps ActionDropdown 16px from both viewport edges when the trigger is near the %s',
    async (side) => {
      renderOverlay(
        <div style={{ height: 400, position: 'relative', width: VIEWPORT_WIDTH }}>
          <ActionDropdown getPopupContainer={() => document.body} menu={menu} open>
            <Trigger side={side} />
          </ActionDropdown>
        </div>,
      );

      const root = await waitFor(() => {
        const node = document.querySelector('.ant-dropdown') as HTMLElement | null;
        expect(node).toBeTruthy();
        return node!;
      });

      assertContentSizedWithGutters(root);
    },
  );

  it('still pins physical left/right gutters under RTL', async () => {
    renderOverlay(
      <ConfigProvider direction="rtl">
        <div style={{ height: 400, position: 'relative', width: VIEWPORT_WIDTH }}>
          <ActionPopover content="panel" getPopupContainer={() => document.body} open title="t">
            <Trigger side="left" />
          </ActionPopover>
        </div>
      </ConfigProvider>,
    );

    const root = await waitFor(() => {
      const node = document.querySelector('.ant-popover') as HTMLElement | null;
      expect(node).toBeTruthy();
      return node!;
    });

    assertContentSizedWithGutters(root);
  });

  it('keeps ActionPopover 16px gutters when the caller sets inline left: 8', async () => {
    renderOverlay(
      <div style={{ height: 400, position: 'relative', width: VIEWPORT_WIDTH }}>
        <ActionPopover
          content="panel"
          getPopupContainer={() => document.body}
          open
          styles={{ root: { left: 8, zIndex: 42 } }}
          title="t"
        >
          <Trigger side="left" />
        </ActionPopover>
      </div>,
    );

    const root = await waitFor(() => {
      const node = document.querySelector('.ant-popover') as HTMLElement | null;
      expect(node).toBeTruthy();
      return node!;
    });

    expect(root.className).toContain(MOBILE_ACTION_OVERLAY_ROOT_CLASS);
    expect(injectedStylesheetText()).toContain('left:50%!important');
    expect(injectedStylesheetText()).toContain('width:max-content!important');
    expect(injectedStylesheetText()).toContain(`var(${MOBILE_ACTION_OVERLAY_MAX_VAR},100vw)`);
    expect(injectedStylesheetText()).not.toContain('transform:translateX(-50%)!important');
  });

  it('keeps ActionDropdown 16px gutters when the caller sets inline left: 8', async () => {
    renderOverlay(
      <div style={{ height: 400, position: 'relative', width: VIEWPORT_WIDTH }}>
        <ActionDropdown
          getPopupContainer={() => document.body}
          menu={menu}
          open
          overlayStyle={{ left: 8, zIndex: 42 }}
        >
          <Trigger side="right" />
        </ActionDropdown>
      </div>,
    );

    const root = await waitFor(() => {
      const node = document.querySelector('.ant-dropdown') as HTMLElement | null;
      expect(node).toBeTruthy();
      return node!;
    });

    expect(root.className).toContain(MOBILE_ACTION_OVERLAY_ROOT_CLASS);
    expect(injectedStylesheetText()).toContain('left:50%!important');
    expect(injectedStylesheetText()).toContain('width:max-content!important');
    expect(injectedStylesheetText()).toContain(`var(${MOBILE_ACTION_OVERLAY_MAX_VAR},100vw)`);
    expect(injectedStylesheetText()).not.toContain('transform:translateX(-50%)!important');
  });

  it('caps ActionPopover at caller maxWidth 320 on the important root rule', async () => {
    renderOverlay(
      <div style={{ height: 400, position: 'relative', width: VIEWPORT_WIDTH }}>
        <ActionPopover
          content={'W'.repeat(80)}
          getPopupContainer={() => document.body}
          maxWidth={320}
          open
          title="t"
        >
          <Trigger side="left" />
        </ActionPopover>
      </div>,
    );

    const root = await waitFor(() => {
      const node = document.querySelector('.ant-popover') as HTMLElement | null;
      expect(node).toBeTruthy();
      return node!;
    });

    expect(root.style.getPropertyValue(MOBILE_ACTION_OVERLAY_MAX_VAR)).toBe('320px');
    expect(injectedStylesheetText()).toContain(`var(${MOBILE_ACTION_OVERLAY_MAX_VAR},100vw)`);
    expect(injectedStylesheetText()).not.toContain('max-width:100%!important');

    const rect = root.getBoundingClientRect();
    if (rect.width > 0) {
      expect(rect.width).toBeLessThanOrEqual(320);
    }
  });

  it('caps ActionDropdown at caller maxWidth 320 on the important root rule', async () => {
    renderOverlay(
      <div style={{ height: 400, position: 'relative', width: VIEWPORT_WIDTH }}>
        <ActionDropdown
          getPopupContainer={() => document.body}
          maxWidth={320}
          menu={{ items: [{ key: 'wide', label: 'W'.repeat(80) }] }}
          open
        >
          <Trigger side="right" />
        </ActionDropdown>
      </div>,
    );

    const root = await waitFor(() => {
      const node = document.querySelector('.ant-dropdown') as HTMLElement | null;
      expect(node).toBeTruthy();
      return node!;
    });

    expect(root.style.getPropertyValue(MOBILE_ACTION_OVERLAY_MAX_VAR)).toBe('320px');
    expect(injectedStylesheetText()).not.toContain('max-width:100%!important');

    const rect = root.getBoundingClientRect();
    if (rect.width > 0) {
      expect(rect.width).toBeLessThanOrEqual(320);
    }
  });
});
