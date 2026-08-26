'use client';

import { Dropdown, DropdownProps } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { memo } from 'react';

import { useIsMobile } from '@/hooks/useIsMobile';

import {
  MOBILE_ACTION_OVERLAY_GUTTER_PX,
  MOBILE_ACTION_OVERLAY_ROOT_CLASS,
  getMobileActionOverlayInnerStyle,
  getMobileActionOverlayRootStyle,
} from './mobileOverlayWidth';

const useStyles = createStyles(({ css, prefixCls }) => ({
  dropdownMenu: css`
    &.${prefixCls}-dropdown-menu {
      .${prefixCls}-dropdown-menu-item-group-list {
        margin: 0;
      }
      .${prefixCls}-avatar {
        margin-inline-end: var(--ant-margin-xs);
      }
    }
  `,
  mobileInner: css`
    box-sizing: border-box;
    width: auto !important;
    max-width: 100% !important;
  `,
  /**
   * Content-sized card, capped to the viewport minus 16px gutters, then
   * centered. Caller `overlayStyle` left/width cannot beat these rules.
   */
  mobileRoot: css`
    left: 50% !important;
    right: auto !important;
    width: max-content !important;
    max-width: calc(100vw - ${MOBILE_ACTION_OVERLAY_GUTTER_PX * 2}px) !important;
    transform: translateX(-50%) !important;
  `,
}));

/**
 * On mobile the overlay is content-sized, capped to the viewport minus 16px
 * gutters, and centered. Callers cannot override left/right/width/transform.
 * `maxWidth` still caps the menu. Other overlay styles still merge.
 */
export interface ActionDropdownProps extends DropdownProps {
  maxHeight?: number | string;
  maxWidth?: number | string;
  minWidth?: number | string;
  /**
   * 是否在挂载时预渲染弹层，避免首次触发展开时的渲染卡顿
   */
  prefetch?: boolean;
}

const ActionDropdown = memo<ActionDropdownProps>(
  ({
    menu,
    maxHeight,
    minWidth,
    maxWidth,
    children,
    placement = 'top',
    prefetch = false,
    destroyOnHidden,
    forceRender,
    overlayClassName,
    overlayStyle,
    ...rest
  }) => {
    const { cx, styles } = useStyles();
    const isMobile = useIsMobile();

    const dropdownForceRender = prefetch ? true : forceRender;
    const dropdownDestroyOnHidden = prefetch ? false : destroyOnHidden;

    return (
      <Dropdown
        arrow={false}
        destroyOnHidden={dropdownDestroyOnHidden}
        forceRender={dropdownForceRender}
        menu={{
          ...menu,
          className: cx(
            styles.dropdownMenu,
            isMobile && styles.mobileInner,
            menu.className,
          ),
          onClick: (e) => {
            e.domEvent.preventDefault();
            menu.onClick?.(e);
          },
          style: {
            maxHeight,
            overflowX: 'hidden',
            overflowY: 'scroll',
            ...(isMobile
              ? {
                  ...getMobileActionOverlayInnerStyle(),
                  ...(maxWidth === undefined ? undefined : { maxWidth }),
                }
              : {
                  maxWidth,
                  minWidth,
                }),
            ...menu.style,
          },
        }}
        overlayClassName={cx(
          isMobile && styles.mobileRoot,
          isMobile && MOBILE_ACTION_OVERLAY_ROOT_CLASS,
          overlayClassName,
        )}
        overlayStyle={
          isMobile || overlayStyle
            ? {
                ...(isMobile ? getMobileActionOverlayRootStyle() : undefined),
                ...overlayStyle,
              }
            : overlayStyle
        }
        placement={isMobile ? 'top' : placement}
        {...rest}
      >
        {children}
      </Dropdown>
    );
  },
);

export default ActionDropdown;
