'use client';

import { Icon } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

const useStyles = createStyles(({ css, token }) => {
  return {
    container: css`
      cursor: pointer;

      width: fit-content;
      height: 24px;
      padding-inline: 8px;
      border-radius: 6px;

      color: ${token.colorTextTertiary};

      &:hover {
        color: ${token.colorTextSecondary};
        background: ${token.colorFillTertiary};
      }
    `,
  };
});

interface GoBackProps {
  /**
   * Fallback absolute path to navigate to (Next App Router path).
   * Used when there is no meaningful browser history to pop to on this route.
   */
  to?: string;
}

/**
 * GoBack component (Next.js App Router).
 * Pops the browser history stack when available; otherwise falls back to `to`.
 */
const GoBack = memo<GoBackProps>(({ to }) => {
  const { t } = useTranslation('components');
  const { styles } = useStyles();
  const router = useRouter();

  const handleClick = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
      return;
    }
    if (to) router.push(to);
  };

  return (
    <Flexbox align={'center'} className={styles.container} gap={4} horizontal onClick={handleClick}>
      <Icon icon={ArrowLeft} />
      <div>{t('GoBack.back')}</div>
    </Flexbox>
  );
});

GoBack.displayName = 'GoBack';

export default GoBack;
