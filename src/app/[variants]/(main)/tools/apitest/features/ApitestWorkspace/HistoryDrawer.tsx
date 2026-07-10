'use client';

import { Button, Drawer, Empty, Popconfirm, Tag, Tooltip, Typography } from 'antd';
import { createStyles } from 'antd-style';
import { Trash2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { formatSize } from '@/utils/format';

import type { ApiTesterHistoryEntry } from './history';

const METHOD_COLORS: Record<string, string> = {
  DELETE: 'red',
  GET: 'green',
  HEAD: 'purple',
  OPTIONS: 'geekblue',
  PATCH: 'cyan',
  POST: 'blue',
  PUT: 'orange',
};

const useStyles = createStyles(({ css, token }) => ({
  entry: css`
    overflow: hidden;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadius}px;

    transition: background 0.2s;
    background: transparent;

    &:hover,
    &:focus-within {
      background: ${token.colorFillTertiary};
    }
  `,
  restoreButton: css`
    cursor: pointer;

    min-width: 0;
    border: 0;

    color: inherit;
    text-align: start;

    background: transparent;

    &:focus-visible {
      outline: 2px solid ${token.colorPrimaryBorder};
      outline-offset: -2px;
    }
  `,
  meta: css`
    font-size: 12px;
    color: ${token.colorTextSecondary};
  `,
  url: css`
    overflow: hidden;

    font-family: ${token.fontFamilyCode};
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

const statusColor = (status: number) =>
  status >= 200 && status < 300 ? 'success' : status >= 300 && status < 400 ? 'warning' : 'error';

interface HistoryDrawerProps {
  entries: ApiTesterHistoryEntry[];
  onClear: () => void;
  onClose: () => void;
  onDelete: (id: string) => void;
  onRestore: (entry: ApiTesterHistoryEntry) => void;
  open: boolean;
}

const HistoryDrawer = memo<HistoryDrawerProps>(
  ({ entries, onClear, onClose, onDelete, onRestore, open }) => {
    const { styles } = useStyles();
    const { t } = useTranslation('tools');

    return (
      <Drawer
        extra={
          entries.length > 0 && (
            <Popconfirm
              cancelText={t('apitest.cancel')}
              okButtonProps={{ danger: true }}
              okText={t('apitest.clearHistory')}
              onConfirm={onClear}
              title={t('apitest.clearHistoryConfirm')}
            >
              <Button danger size={'small'} type={'text'}>
                {t('apitest.clearHistory')}
              </Button>
            </Popconfirm>
          )
        }
        onClose={onClose}
        open={open}
        placement={'right'}
        title={t('apitest.history')}
        width={420}
      >
        {entries.length === 0 ? (
          <Empty description={t('apitest.historyEmpty')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Flexbox gap={8}>
            {entries.map((entry) => (
              <Tooltip key={entry.id} mouseEnterDelay={0.5} title={t('apitest.restore')}>
                <Flexbox align={'stretch'} className={styles.entry} horizontal>
                  <button
                    aria-label={t('apitest.restoreHistoryEntry', {
                      method: entry.request.method,
                      url: entry.request.url,
                    })}
                    className={styles.restoreButton}
                    onClick={() => onRestore(entry)}
                    type={'button'}
                  >
                    <Flexbox gap={6} style={{ padding: 10 }}>
                      <Flexbox align={'center'} gap={8} horizontal>
                        <Tag color={METHOD_COLORS[entry.request.method] ?? 'default'}>
                          {entry.request.method}
                        </Tag>
                        {entry.response && (
                          <Tag color={statusColor(entry.response.status)}>
                            {entry.response.status}
                          </Tag>
                        )}
                      </Flexbox>
                      <Typography.Text className={styles.url}>{entry.request.url}</Typography.Text>
                      <Flexbox align={'center'} gap={12} horizontal>
                        <span className={styles.meta}>
                          {new Date(entry.createdAt).toLocaleString()}
                        </span>
                        {entry.response && (
                          <span className={styles.meta}>
                            {entry.response.time}ms · {formatSize(entry.response.size)}
                          </span>
                        )}
                      </Flexbox>
                    </Flexbox>
                  </button>
                  <Flexbox justify={'center'} style={{ padding: '8px 8px 8px 0' }}>
                    <Button
                      aria-label={t('apitest.deleteHistoryEntry')}
                      danger
                      icon={<Trash2 size={12} />}
                      onClick={() => onDelete(entry.id)}
                      size={'small'}
                      type={'text'}
                    />
                  </Flexbox>
                </Flexbox>
              </Tooltip>
            ))}
          </Flexbox>
        )}
      </Drawer>
    );
  },
);

HistoryDrawer.displayName = 'HistoryDrawer';

export default HistoryDrawer;
