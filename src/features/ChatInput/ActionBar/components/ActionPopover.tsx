'use client';

import { Popover, PopoverProps } from 'antd';
import { createStyles } from 'antd-style';
import { ReactNode, memo } from 'react';
import { Flexbox } from 'react-layout-kit';

import UpdateLoading from '@/components/Loading/UpdateLoading';
import { useIsMobile } from '@/hooks/useIsMobile';

import {
  MOBILE_ACTION_OVERLAY_ROOT_CLASS,
  getMobileActionOverlayMaxWidth,
  getMobileActionOverlayRootStyle,
} from './mobileOverlayWidth';

const useStyles = createStyles(({ css, prefixCls }) => ({
  /**
   * Opt-in fixed width: pin to min(caller max, 100vw - 32px) instead of
   * content-sizing. Ant Design Popover otherwise sizes to content:
   * https://ant.design/components/popover
   */
  mobileFixedRoot: css`
    box-sizing: border-box;
    left: 50% !important;
    right: auto !important;
    width: ${getMobileActionOverlayMaxWidth()} !important;
    max-width: ${getMobileActionOverlayMaxWidth()} !important;
    translate: -50% 0;

    .${prefixCls}-popover-title {
      white-space: normal;
    }
  `,
  mobileInner: css`
    box-sizing: border-box;
    width: auto;
    max-width: 100%;
  `,
  /** Center with `translate`; cap via --chathub-mobile-overlay-max. */
  mobileRoot: css`
    box-sizing: border-box;
    left: 50% !important;
    right: auto !important;
    width: max-content !important;
    max-width: ${getMobileActionOverlayMaxWidth()} !important;
    translate: -50% 0;

    .${prefixCls}-popover-title {
      white-space: normal;
    }
  `,
  popoverContent: css`
    .${prefixCls}-form {
      .${prefixCls}-form-item:first-child {
        padding-block: 0 4px;
      }
      .${prefixCls}-form-item:last-child {
        padding-block: 4px 0;
      }
    }
  `,
}));

/**
 * Mobile overlays are content-sized, gutter-capped, and centered by default.
 * `maxWidth` is applied via a CSS variable on the root; left/width cannot be
 * overridden. Pass `fixedWidth` to pin width to that cap (context-usage card).
 */
export interface ActionPopoverProps extends Omit<PopoverProps, 'title' | 'content'> {
  compact?: boolean;
  content?: ReactNode;
  extra?: ReactNode;
  /** Pin mobile width to min(maxWidth, 100vw - 32px) instead of content size. */
  fixedWidth?: boolean;
  loading?: boolean;
  maxHeight?: number | string;
  maxWidth?: number | string;
  minWidth?: number | string;
  title?: ReactNode;
}

const ActionPopover = memo<ActionPopoverProps>(
  ({
    compact,
    fixedWidth,
    styles: customStyles,
    maxHeight,
    maxWidth,
    minWidth,
    children,
    classNames,
    title,
    placement,
    loading,
    extra,
    ...rest
  }) => {
    const { cx, styles, theme } = useStyles();
    const isMobile = useIsMobile();
    const mobileRootClass = fixedWidth ? styles.mobileFixedRoot : styles.mobileRoot;
    return (
      <Popover
        arrow={false}
        classNames={{
          ...classNames,
          body: cx(styles.popoverContent, isMobile && styles.mobileInner, classNames?.body),
          root: cx(
            isMobile && mobileRootClass,
            isMobile && MOBILE_ACTION_OVERLAY_ROOT_CLASS,
            classNames?.root,
          ),
        }}
        placement={isMobile ? 'top' : placement}
        styles={{
          ...customStyles,
          body: {
            maxHeight,
            ...(isMobile
              ? undefined
              : {
                  maxWidth,
                  minWidth,
                }),
            ...customStyles?.body,
          },
          root: {
            ...(isMobile ? getMobileActionOverlayRootStyle(maxWidth) : undefined),
            ...customStyles?.root,
          },
        }}
        title={
          title && (
            <Flexbox
              gap={8}
              horizontal
              justify={'space-between'}
              style={{ marginBottom: compact ? 8 : 16, maxWidth: '100%', minWidth: 0 }}
            >
              {title}
              {extra}
              {loading && <UpdateLoading style={{ color: theme.colorTextSecondary }} />}
            </Flexbox>
          )
        }
        {...rest}
      >
        {children}
      </Popover>
    );
  },
);

export default ActionPopover;
