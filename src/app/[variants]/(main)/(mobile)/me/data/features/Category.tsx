'use client';

import { App } from 'antd';
import { HardDriveDownload, HardDriveUpload } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import Cell, { CellProps } from '@/components/Cell';
import DataImporter from '@/features/DataImporter';
import { configService } from '@/services/config';

const Category = memo(() => {
  const { t } = useTranslation('setting');
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
      icon: HardDriveUpload,
      key: 'all',
      label: t('storage.actions.export.title'),
      onClick: runExport(configService.exportAll),
    },
    {
      type: 'divider',
    },
    {
      icon: HardDriveDownload,
      key: 'import',
      label: <DataImporter>{t('storage.actions.import.title')}</DataImporter>,
    },
  ];

  return items?.map(({ key, ...item }, index) => <Cell key={key || index} {...item} />);
});

export default Category;
