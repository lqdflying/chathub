import { createStyles } from 'antd-style';
import { useRouter } from 'next/navigation';
import React, { memo } from 'react';
import { Flexbox } from 'react-layout-kit';

import Content, { knowledgeItemClass } from './Content';

const useStyles = createStyles(({ css, token, isDarkMode }) => ({
  active: css`
    background: ${isDarkMode ? token.colorFillSecondary : token.colorFillTertiary};
    transition: background 200ms ${token.motionEaseOut};

    &:hover {
      background: ${token.colorFill};
    }
  `,
  container: css`
    cursor: pointer;

    margin-inline: 8px;
    padding-block: 4px;
    padding-inline: 8px;
    border-radius: ${token.borderRadius}px;

    &.${knowledgeItemClass} {
      width: calc(100% - 16px);
    }

    &:hover {
      background: ${token.colorFillSecondary};
    }
  `,
  split: css`
    border-block-end: 1px solid ${token.colorSplit};
  `,
}));

export interface KnowledgeBaseItemProps {
  active?: boolean;
  id: string;
  name: string;
  /** Called after the user navigates to this knowledge base. */
  onNavigate?: () => void;
}

const KnowledgeBaseItem = memo<KnowledgeBaseItemProps>(({ name, active, id, onNavigate }) => {
  const { styles, cx } = useStyles();
  const router = useRouter();

  const handleClick = () => {
    router.push(`/knowledge/bases/${id}`);
    onNavigate?.();
  };

  return (
    <Flexbox
      align={'center'}
      className={cx(styles.container, knowledgeItemClass, active && styles.active)}
      distribution={'space-between'}
      horizontal
      onClick={handleClick}
      style={{ cursor: 'pointer' }}
    >
      <Content id={id} name={name} showMore />
    </Flexbox>
  );
});

KnowledgeBaseItem.displayName = 'KnowledgeBaseItem';

export default KnowledgeBaseItem;
