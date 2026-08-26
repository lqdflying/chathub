'use client';

import { ActionIcon } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { Trash2Icon } from 'lucide-react';
import { memo, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { getPastedTextPreview } from './helpers';

const useStyles = createStyles(({ css, token, isDarkMode }) => ({
  badge: css`
    display: inline-flex;
    flex: none;
    align-items: center;

    padding-block: 0;
    padding-inline: 6px;
    border: 1px solid ${token.colorBorder};
    border-radius: 4px;

    font-size: 10px;
    font-weight: 600;
    line-height: 18px;
    letter-spacing: 0.04em;
    color: ${token.colorTextSecondary};
  `,
  clickable: css`
    cursor: pointer;

    &:hover {
      background: ${token.colorFillTertiary};
    }
  `,
  container: css`
    position: relative;

    overflow: hidden;

    width: 260px;
    max-width: 100%;
    padding-block: 8px;
    padding-inline: 10px;
    border: 1px solid ${isDarkMode ? token.colorBorder : token.colorSplit};
    border-radius: 8px;

    background: ${token.colorBgContainer};
  `,
  preview: css`
    overflow: hidden;

    margin: 0;

    font-family: ${token.fontFamilyCode};
    font-size: 12px;
    line-height: 1.25;
    color: ${token.colorTextTertiary};
    word-break: break-word;
    white-space: pre-wrap;
  `,
  remove: css`
    position: absolute;
    z-index: 1;
    inset-block-start: 4px;
    inset-inline-end: 4px;
  `,
}));

export interface PastedTextCardProps {
  content: string;
  onOpen?: () => void;
  onRemove?: () => void;
}

const PastedTextCard = memo<PastedTextCardProps>(({ content, onOpen, onRemove }) => {
  const { t } = useTranslation(['chat', 'common']);
  const { cx, styles } = useStyles();
  const interactive = Boolean(onOpen);

  const handleRemove = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onRemove?.();
  };

  return (
    <Flexbox
      aria-label={interactive ? t('chatList.pastedAria') : undefined}
      className={cx(styles.container, interactive && styles.clickable)}
      data-pasted-text-card=""
      gap={8}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (!onOpen) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
    >
      {onRemove && (
        <ActionIcon
          className={styles.remove}
          color={'red'}
          icon={Trash2Icon}
          onClick={handleRemove}
          size={'small'}
          title={t('delete', { ns: 'common' })}
        />
      )}
      <pre className={styles.preview}>{getPastedTextPreview(content)}</pre>
      <span className={styles.badge}>{t('chatList.pasted')}</span>
    </Flexbox>
  );
});

PastedTextCard.displayName = 'PastedTextCard';

export default PastedTextCard;
