import { render } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ActionDropdown from './ActionDropdown';
import {
  MOBILE_ACTION_OVERLAY_ROOT_CLASS,
  getMobileActionOverlayRootStyle,
} from './mobileOverlayWidth';

vi.stubGlobal('React', React);

const { useIsMobile } = vi.hoisted(() => ({
  useIsMobile: vi.fn(() => false),
}));

let lastDropdownProps: Record<string, unknown> | undefined;

vi.mock('@/hooks/useIsMobile', () => ({
  useIsMobile,
}));

vi.mock('antd-style', () => ({
  createStyles: () => () => ({
    cx: (...args: Array<string | undefined>) => args.filter(Boolean).join(' '),
    styles: { dropdownMenu: 'dropdownMenu', mobileInner: 'mobileInner', mobileRoot: 'mobileRoot' },
  }),
}));

vi.mock('@lobehub/ui', () => ({
  Dropdown: (props: Record<string, unknown>) => {
    lastDropdownProps = props;
    return <div>{props.children as never}</div>;
  },
}));

const menu = { items: [{ key: 'one', label: 'One' }] };

describe('ActionDropdown mobile overlay width', () => {
  beforeEach(() => {
    lastDropdownProps = undefined;
    useIsMobile.mockReturnValue(false);
  });

  it('keeps desktop minWidth and maxWidth on the menu and does not pin overlayStyle', () => {
    render(
      <ActionDropdown maxWidth={360} menu={menu} minWidth={240}>
        trigger
      </ActionDropdown>,
    );

    const menuProps = lastDropdownProps?.menu as { style?: Record<string, unknown> };

    expect(menuProps.style).toMatchObject({ maxWidth: 360, minWidth: 240 });
    expect(menuProps.style?.width).toBeUndefined();
    expect(lastDropdownProps?.overlayStyle).toBeUndefined();
    expect(lastDropdownProps?.overlayClassName).toBeFalsy();
  });

  it('caps the mobile dropdown root via CSS variable and keeps the gutter class', () => {
    useIsMobile.mockReturnValue(true);

    render(
      <ActionDropdown maxWidth={360} menu={menu} minWidth={240}>
        trigger
      </ActionDropdown>,
    );

    const menuProps = lastDropdownProps?.menu as { style?: Record<string, unknown> };

    expect(lastDropdownProps?.overlayStyle).toEqual(getMobileActionOverlayRootStyle(360));
    expect(menuProps.style?.maxWidth).toBeUndefined();
    expect(menuProps.style?.minWidth).toBeUndefined();
    expect(menuProps.style?.width).toBeUndefined();
    expect(String((lastDropdownProps?.menu as { className?: string })?.className)).toContain(
      'mobileInner',
    );
    expect(String(lastDropdownProps?.overlayClassName)).toContain(MOBILE_ACTION_OVERLAY_ROOT_CLASS);
    expect(String(lastDropdownProps?.overlayClassName)).toContain('mobileRoot');
  });

  it('forwards non-positional overlayStyle and keeps the non-overridable gutter class', () => {
    useIsMobile.mockReturnValue(true);

    render(
      <ActionDropdown menu={menu} overlayStyle={{ left: 8, zIndex: 42 }}>
        trigger
      </ActionDropdown>,
    );

    expect(lastDropdownProps?.overlayStyle).toMatchObject({ zIndex: 42 });
    expect(String(lastDropdownProps?.overlayClassName)).toContain(MOBILE_ACTION_OVERLAY_ROOT_CLASS);
    expect(String(lastDropdownProps?.overlayClassName)).toContain('mobileRoot');
  });
});
