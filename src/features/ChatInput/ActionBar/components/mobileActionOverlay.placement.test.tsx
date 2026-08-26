import { render, waitFor } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import { ThemeProvider } from 'antd-style';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ActionDropdown from './ActionDropdown';
import ActionPopover from './ActionPopover';
import {
  MOBILE_ACTION_OVERLAY_GUTTER_PX,
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
const GUTTER = `${MOBILE_ACTION_OVERLAY_GUTTER_PX}px`;

const menu = { items: [{ key: 'one', label: 'One' }] };

const renderOverlay = (ui: React.ReactElement) => render(<ThemeProvider>{ui}</ThemeProvider>);

const injectedStylesheetText = () =>
  Array.from(document.querySelectorAll('style'))
    .map((node) => node.textContent ?? '')
    .join('\n')
    .replace(/\s+/g, '');

const assertPinnedToGutters = (root: HTMLElement) => {
  expect(root.className).toContain(MOBILE_ACTION_OVERLAY_ROOT_CLASS);
  expect(root.style.left).toBe(GUTTER);
  expect(root.style.right).toBe(GUTTER);
  expect(root.style.width).toBe('auto');

  // rc-trigger useAlign writes these inline after React commit.
  root.style.left = '0px';
  root.style.right = 'auto';

  const computed = window.getComputedStyle(root);
  if (computed.left && computed.left !== 'auto') {
    expect(Number.parseFloat(computed.left)).toBeGreaterThanOrEqual(MOBILE_ACTION_OVERLAY_GUTTER_PX);
  }

  const rect = root.getBoundingClientRect();
  if (rect.width > 0) {
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

      assertPinnedToGutters(root);
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

      assertPinnedToGutters(root);
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

    assertPinnedToGutters(root);
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
    expect(injectedStylesheetText()).toContain('left:16px!important');
    expect(injectedStylesheetText()).toContain('right:16px!important');

    const computedLeft = Number.parseFloat(window.getComputedStyle(root).left);
    if (!Number.isNaN(computedLeft) && computedLeft !== 8) {
      expect(computedLeft).toBe(MOBILE_ACTION_OVERLAY_GUTTER_PX);
    }
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
    expect(injectedStylesheetText()).toContain('left:16px!important');
    expect(injectedStylesheetText()).toContain('right:16px!important');

    const computedLeft = Number.parseFloat(window.getComputedStyle(root).left);
    if (!Number.isNaN(computedLeft) && computedLeft !== 8) {
      expect(computedLeft).toBe(MOBILE_ACTION_OVERLAY_GUTTER_PX);
    }
  });
});
