'use client';

import { Button, Modal, Text } from '@lobehub/ui';
import { Alert, Checkbox, Radio, Space, Table } from 'antd';
import { createStyles } from 'antd-style';
import { Info } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import {
  DATA_BACKUP_TABLES,
  DataImportStrategy,
  ImportPgDataStructure,
  getIgnoredBackupTables,
} from '@/types/export';

const getNonEmptyTables = (data: ImportPgDataStructure) => {
  const result = [];

  for (const [key, value] of Object.entries(data.data)) {
    if (
      DATA_BACKUP_TABLES.includes(key as (typeof DATA_BACKUP_TABLES)[number]) &&
      Array.isArray(value) &&
      value.length > 0
    ) {
      result.push({
        count: value.length,
        name: key,
      });
    }
  }

  return result;
};

const getTotalRecords = (tables: { count: number; name: string }[]): number => {
  return tables.reduce((sum, table) => sum + table.count, 0);
};

const useStyles = createStyles(({ token, css }) => {
  return {
    duplicateAlert: css`
      margin-block-start: ${token.marginMD}px;
      padding: ${token.paddingMD}px;
      border: 1px solid ${token.colorWarningBorder};
      border-radius: ${token.borderRadiusLG}px;

      background-color: ${token.colorWarningBg};
    `,
    duplicateDescription: css`
      margin-block-start: ${token.marginXS}px;
      font-size: ${token.fontSizeSM}px;
      color: ${token.colorTextSecondary};
    `,
    duplicateOptions: css`
      margin-block-start: ${token.marginSM}px;
    `,
    duplicateTag: css`
      border-color: ${token.colorWarningBorder};
      color: ${token.colorWarning};
      background-color: ${token.colorWarningBg};
    `,
    hash: css`
      font-family: ${token.fontFamilyCode};
      font-size: 12px;
      color: ${token.colorTextTertiary};
    `,
    infoIcon: css`
      color: ${token.colorTextSecondary};
    `,
    modalContent: css`
      padding-block: ${token.paddingMD}px;
      padding-inline: 0;
    `,
    successIcon: css`
      color: ${token.colorSuccess};
    `,
    tableContainer: css`
      overflow: hidden;
      border: 1px solid ${token.colorBorderSecondary};
      border-radius: ${token.borderRadiusLG}px;
    `,
    tableName: css`
      font-family: ${token.fontFamilyCode};
    `,
    warningIcon: css`
      color: ${token.colorWarning};
    `,
  };
});

interface ImportPreviewModalProps {
  importData: ImportPgDataStructure;
  onCancel?: () => void;
  onConfirm?: (strategy: DataImportStrategy) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

const ImportPreviewModal = ({
  open = true,
  onOpenChange = () => {},
  onConfirm = () => {},
  onCancel = () => {},
  importData,
}: ImportPreviewModalProps) => {
  const { t } = useTranslation('common');
  const { styles } = useStyles();
  const [strategy, setStrategy] = useState<DataImportStrategy>('merge');
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const tables = getNonEmptyTables(importData);
  const totalRecords = getTotalRecords(tables);
  const ignoredTables = getIgnoredBackupTables(importData);
  const isV2 = 'formatVersion' in importData;

  // 表格列定义
  const columns = [
    {
      dataIndex: 'name',
      key: 'name',
      render: (text: string) => <div className={styles.tableName}>{text}</div>,
      title: t('importPreview.tables.name'),
    },
    {
      dataIndex: 'count',
      key: 'count',
      title: t('importPreview.tables.count'),
    },
  ];

  const handleConfirm = () => {
    onConfirm(strategy);
    onOpenChange(false);
  };

  return (
    <Modal
      footer={[
        <Button
          key="cancel"
          onClick={() => {
            onOpenChange(false);
            onCancel();
          }}
        >
          {t('cancel')}
        </Button>,
        <Button
          danger={strategy === 'replace'}
          disabled={strategy === 'replace' && !replaceConfirmed}
          key="confirm"
          onClick={handleConfirm}
          type="primary"
        >
          {t('importPreview.confirmImport')}
        </Button>,
      ]}
      onCancel={() => onOpenChange(false)}
      open={open}
      title={t('importPreview.title')}
      width={700}
    >
      <div className={styles.modalContent}>
        <Flexbox gap={16}>
          <Flexbox gap={4}>
            <Flexbox align="center" horizontal justify="space-between" width="100%">
              <Flexbox align="center" gap={8} horizontal>
                <Info className={styles.infoIcon} size={16} />
                <Text strong>{t('importPreview.totalRecords', { count: totalRecords })}</Text>
              </Flexbox>
              <Flexbox horizontal>
                <Text type="secondary">
                  {t('importPreview.totalTables', { count: tables.length })}
                </Text>
              </Flexbox>
            </Flexbox>
            <Flexbox className={styles.hash} gap={4} horizontal>
              Hash: <span>{importData.schemaHash}</span>
            </Flexbox>
            <Flexbox className={styles.hash} gap={4}>
              <span>
                {t('importPreview.format')}:{' '}
                {isV2 ? `v${importData.formatVersion} · ${importData.appVersion}` : 'Legacy v1'}
              </span>
              <span>
                {t('importPreview.source')}: {importData.mode}
              </span>
              {isV2 && (
                <span>
                  {t('importPreview.exportedAt')}: {new Date(importData.exportedAt).toLocaleString()}
                </span>
              )}
            </Flexbox>
          </Flexbox>

          <div className={styles.tableContainer}>
            <Table
              columns={columns}
              dataSource={tables}
              pagination={false}
              rowKey="name"
              scroll={{ y: 350 }}
              size="small"
            />
          </div>

          {ignoredTables.length > 0 && (
            <Alert
              description={t('importPreview.ignoredTablesDescription', {
                tables: ignoredTables.join(', '),
              })}
              message={t('importPreview.ignoredTables')}
              showIcon
              type="warning"
            />
          )}

          <Alert
            description={t('importPreview.credentialsDescription')}
            message={t('importPreview.credentials')}
            showIcon
            type="info"
          />

          <Flexbox gap={8}>
            <Text strong>{t('importPreview.strategy.title')}</Text>
            <Radio.Group
              onChange={(event) => {
                setStrategy(event.target.value);
                setReplaceConfirmed(false);
              }}
              value={strategy}
            >
              <Space direction="vertical">
                <Radio value="merge">{t('importPreview.strategy.merge')}</Radio>
                <Radio value="replace">{t('importPreview.strategy.replace')}</Radio>
              </Space>
            </Radio.Group>
            <Text type="secondary">
              {t(`importPreview.strategy.${strategy}Description`)}
            </Text>
            {strategy === 'replace' && (
              <Alert
                description={
                  <Checkbox
                    checked={replaceConfirmed}
                    onChange={(event) => setReplaceConfirmed(event.target.checked)}
                  >
                    {t('importPreview.strategy.replaceConfirm')}
                  </Checkbox>
                }
                message={t('importPreview.strategy.replaceWarning')}
                showIcon
                type="warning"
              />
            )}
          </Flexbox>
        </Flexbox>
      </div>
    </Modal>
  );
};

export default ImportPreviewModal;
