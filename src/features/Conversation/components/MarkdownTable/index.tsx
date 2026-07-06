'use client';

import { ActionIcon, copyToClipboard } from '@lobehub/ui';
import { App } from 'antd';
import { createStyles } from 'antd-style';
import { CopyIcon, FileSpreadsheetIcon } from 'lucide-react';
import React, { ComponentProps, memo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { extractTableRows, tableRowsToCsv, tableRowsToMarkdown } from './utils';

const useStyles = createStyles(({ css, responsive, token }) => ({
  actions: css`
    position: absolute;
    z-index: 2;
    inset-block-start: 4px;
    inset-inline-end: 4px;

    display: flex;
    gap: 2px;

    padding: 2px;
    border-radius: ${token.borderRadius}px;

    opacity: 0;
    background: ${token.colorBgElevated};
    box-shadow: ${token.boxShadowTertiary};

    transition: opacity 0.2s ${token.motionEaseInOut};

    ${responsive.mobile} {
      position: static;

      align-self: flex-end;
      order: -1;

      margin-block-end: 4px;

      opacity: 1;
    }
  `,
  container: css`
    position: relative;

    display: flex;
    flex-direction: column;

    max-width: 100%;

    &:hover > div,
    &:focus-within > div {
      opacity: 1;
    }
  `,
}));

/**
 * Table renderer for chat markdown: keeps the library's scrollable table
 * rendering and adds copy-as-Markdown / copy-as-CSV actions.
 */
const MarkdownTable = memo<ComponentProps<'table'>>(({ children, ...rest }) => {
  const tableRef = useRef<HTMLTableElement>(null);
  const { styles } = useStyles();
  const { message } = App.useApp();
  const { t } = useTranslation('components');

  const handleCopy = useCallback(
    async (format: 'csv' | 'markdown') => {
      if (!tableRef.current) return;

      const rows = extractTableRows(tableRef.current);
      const text = format === 'markdown' ? tableRowsToMarkdown(rows) : tableRowsToCsv(rows);

      await copyToClipboard(text);
      message.success(t('MarkdownTable.copySuccess'));
    },
    [message, t],
  );

  return (
    <div className={styles.container}>
      <table ref={tableRef} {...rest}>
        {children}
      </table>
      <div
        aria-label={`${t('MarkdownTable.copyAsMarkdown')} / ${t('MarkdownTable.copyAsCsv')}`}
        className={styles.actions}
        role={'toolbar'}
      >
        <ActionIcon
          icon={CopyIcon}
          onClick={() => handleCopy('markdown')}
          size={'small'}
          title={t('MarkdownTable.copyAsMarkdown')}
        />
        <ActionIcon
          icon={FileSpreadsheetIcon}
          onClick={() => handleCopy('csv')}
          size={'small'}
          title={t('MarkdownTable.copyAsCsv')}
        />
      </div>
    </div>
  );
});

MarkdownTable.displayName = 'MarkdownTable';

export default MarkdownTable;
