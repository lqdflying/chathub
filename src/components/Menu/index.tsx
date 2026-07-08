import { Menu as AntdMenu, MenuProps as AntdMenuProps, ConfigProvider } from 'antd';
import { createStyles } from 'antd-style';
import { memo } from 'react';

const useStyles = createStyles(({ css, token, prefixCls }) => ({
  compact: css`
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  `,
  menu: css`
    flex: 1;
    border: none !important;
    background: transparent;

    .${prefixCls}-menu-item-divider {
      margin-block: 0.375rem;
      border-color: ${token.colorFillTertiary};

      &:first-child {
        margin-block-start: 0;
      }

      &:last-child {
        margin-block-end: 0;
      }
    }

    .${prefixCls}-menu-item, .${prefixCls}-menu-submenu-title {
      display: flex;
      gap: 0.625rem;
      align-items: center;

      height: unset;
      min-height: 2.25rem;
      padding-block: 0.375rem;
      padding-inline: 0.625rem 0.75rem;

      line-height: 1.6;

      transition:
        background-color ${token.motionDurationMid} ${token.motionEaseOut},
        color ${token.motionDurationMid} ${token.motionEaseOut};

      .anticon + .${prefixCls}-menu-title-content {
        margin-inline-start: 0;
      }

      &:focus-visible {
        outline: 2px solid ${token.colorPrimaryBorder};
        outline-offset: 2px;
      }
    }

    .${prefixCls}-menu-item-selected {
      font-weight: 500;

      .${prefixCls}-menu-item-icon svg {
        color: ${token.colorPrimary};
      }
    }

    .${prefixCls}-menu-item-icon svg {
      color: ${token.colorTextSecondary};
      transition: color ${token.motionDurationMid} ${token.motionEaseOut};
    }

    .${prefixCls}-menu-item:hover .${prefixCls}-menu-item-icon svg,
    .${prefixCls}-menu-submenu-title:hover .${prefixCls}-menu-item-icon svg {
      color: ${token.colorText};
    }

    .${prefixCls}-menu-title-content {
      flex: 1;
    }
  `,
}));

export interface MenuProps extends AntdMenuProps {
  compact?: boolean;
}

const Menu = memo<MenuProps>(({ className, selectable = false, compact, ...rest }) => {
  const { cx, styles, theme } = useStyles();
  return (
    <ConfigProvider
      theme={{
        components: {
          Menu: {
            controlHeightLG: 36,
            iconMarginInlineEnd: 8,
            iconSize: 16,
            itemActiveBg: theme.colorFillQuaternary,
            itemBorderRadius: theme.borderRadiusLG,
            itemColor: selectable ? theme.colorTextSecondary : theme.colorText,
            itemHoverBg: theme.colorFillQuaternary,
            itemHoverColor: theme.colorText,
            itemMarginBlock: compact ? 0 : 4,
            itemMarginInline: compact ? 0 : 4,
            itemSelectedBg: theme.colorPrimaryBg,
            itemSelectedColor: theme.colorPrimaryText,
            paddingXS: -8,
          },
        },
      }}
    >
      <AntdMenu
        className={cx(styles.menu, compact && styles.compact, className)}
        mode="vertical"
        selectable={selectable}
        {...rest}
      />
    </ConfigProvider>
  );
});

export default Menu;
