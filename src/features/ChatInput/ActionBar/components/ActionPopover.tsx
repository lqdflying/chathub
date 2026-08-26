'use client';

import { Popover, PopoverProps } from 'antd';
import { createStyles } from 'antd-style';
import { ReactNode, memo } from 'react';
import { Flexbox } from 'react-layout-kit';

import UpdateLoading from '@/components/Loading/UpdateLoading';
import { useIsMobile } from '@/hooks/useIsMobile';

import {
  MOBILE_ACTION_OVERLAY_GUTTER_PX,
  MOBILE_ACTION_OVERLAY_ROOT_CLASS,
  getMobileActionOverlayInnerStyle,
  getMobileActionOverlayRootStyle,
} from './mobileOverlayWidth';

const useStyles = createStyles(({ css, prefixCls }) => ({
  mobileInner: css`
    box-sizing: border-box;
    width: auto !important;
    max-width: 100% !important;
  `,
  /**
   * Content-sized card, capped to the viewport minus 16px gutters, then
   * centered. Do not stretch with left+right and width:auto (MDN abspos fill).
   * Callers cannot opt out of this pin via `styles.root` left/width.
   */
  mobileRoot: css`
    left: 50% !important;
    right: auto !important;
    width: max-content !important;
    max-width: calc(100vw - ${MOBILE_ACTION_OVERLAY_GUTTER_PX * 2}px) !important;
    transform: translateX(-50%) !important;

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
 * On mobile the overlay is content-sized, capped to the viewport minus 16px
 * gutters, and centered. Callers cannot override left/right/width/transform.
 * `maxWidth` still caps the inner card. Other root styles still merge.
 */
export interface ActionPopoverProps extends Omit<PopoverProps, 'title' | 'content'> {
  compact?: boolean;
  content?: ReactNode;
  extra?: ReactNode;
  loading?: boolean;
  maxHeight?: number | string;
  maxWidth?: number | string;
  minWidth?: number | string;
  title?: ReactNode;
}

const ActionPopover = memo<ActionPopoverProps>(
  ({
    compact,
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
    return (
      <Popover
        arrow={false}
        classNames={{
          ...classNames,
          body: cx(styles.popoverContent, isMobile && styles.mobileInner, classNames?.body),
          root: cx(
            isMobile && styles.mobileRoot,
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
              ? {
                  ...getMobileActionOverlayInnerStyle(),
                  ...(maxWidth === undefined ? undefined : { maxWidth }),
                }
              : {
                  maxWidth,
                  minWidth,
                }),
            ...customStyles?.body,
          },
          root: {
            ...(isMobile ? getMobileActionOverlayRootStyle() : undefined),
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
