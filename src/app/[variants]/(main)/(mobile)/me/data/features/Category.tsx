'use client';

import { App } from 'antd';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import Cell, { CellProps } from '@/components/Cell';
import DataImporter from '@/features/DataImporter';
import { configService } from '@/services/config';

const Category = memo(() => {
  const { t } = useTranslation('common');
  const { message } = App.useApp();
  const runExport = (action: () => Promise<void>) => async () => {
    try {
      await action();
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  };
  const items: CellProps[] = [
    {
      key: 'all',
      label: t('exportType.all'),
      onClick: runExport(configService.exportAll),
    },
    {
      type: 'divider',
    },
    {
      key: 'import',
      label: <DataImporter>{t('importData')}</DataImporter>,
    },
  ];

  return items?.map(({ key, ...item }, index) => <Cell key={key || index} {...item} />);
});

export default Category;
