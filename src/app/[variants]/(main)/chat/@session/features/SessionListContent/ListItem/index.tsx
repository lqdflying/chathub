import { Avatar, GroupAvatar, List, type ListItemProps } from '@lobehub/ui';
import { useHover } from 'ahooks';
import { createStyles } from 'antd-style';
import { rgba } from 'polished';
import { memo, useMemo, useRef } from 'react';

import { useServerConfigStore } from '@/store/serverConfig';

const { Item } = List;

const useStyles = createStyles(({ css, token }) => {
  return {
    active: css`
      border-color: ${rgba(token.colorPrimary, 0.22)};
      background: ${rgba(token.colorPrimary, 0.08)};
    `,
    container: css`
      position: relative;

      min-height: 58px;
      margin-block: 1px;
      padding-block: 7px;
      padding-inline: 10px 12px;
      border: 1px solid transparent;
      border-radius: ${token.borderRadiusLG}px;

      transition:
        background-color 160ms ${token.motionEaseOut},
        border-color 160ms ${token.motionEaseOut};

      &:hover {
        border-color: ${rgba(token.colorBorderSecondary, 0.68)};
        background: ${token.colorFillQuaternary};
      }
    `,
    mobile: css`
      min-height: 64px;
      margin-block: 0;
      padding-block: 10px;
      padding-inline: 14px 16px;
      border-inline: 0;
      border-radius: 0;
    `,
    title: css`
      line-height: 1.25;
    `,
  };
});

const ListItem = memo<
  ListItemProps & {
    avatar: string | { avatar: string; background?: string }[];
    avatarBackground?: string;
    type?: 'agent' | 'group' | 'inbox';
  }
>(({ avatar, avatarBackground, active, showAction, actions, title, type, ...props }) => {
  const ref = useRef(null);
  const isHovering = useHover(ref);
  const mobile = useServerConfigStore((s) => s.isMobile);
  const { cx, styles } = useStyles();

  const avatarRender = useMemo(() => {
    if (type === 'group') {
      const avatars = Array.isArray(avatar) ? avatar : [avatar];
      return <GroupAvatar avatars={avatars} size={40} />;
    }

    // For regular sessions, use the regular Avatar component
    return (
      <Avatar
        animation={isHovering}
        avatar={avatar}
        background={avatarBackground}
        shape="circle"
        size={40}
      />
    );
  }, [isHovering, avatar, avatarBackground, type]);

  return (
    <Item
      actions={actions}
      active={mobile ? false : active}
      avatar={avatarRender}
      className={cx(styles.container, !mobile && active && styles.active, mobile && styles.mobile)}
      ref={ref}
      showAction={actions && (isHovering || showAction || mobile)}
      title={<span className={styles.title}>{title}</span>}
      {...(props as any)}
    />
  );
});

export default ListItem;
