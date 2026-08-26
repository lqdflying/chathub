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
    width: 100% !important;
    max-width: 100% !important;
  `,
  /**
   * Beat rc-trigger's post-commit `element.style.left/right` writes.
   * Stylesheet `!important` wins over inline offsets without `!important`.
   */
  mobileRoot: css`
    left: ${MOBILE_ACTION_OVERLAY_GUTTER_PX}px !important;
    right: ${MOBILE_ACTION_OVERLAY_GUTTER_PX}px !important;
    width: auto !important;
    max-width: none !important;
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
              ? getMobileActionOverlayInnerStyle()
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
              style={{ marginBottom: compact ? 8 : 16 }}
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
