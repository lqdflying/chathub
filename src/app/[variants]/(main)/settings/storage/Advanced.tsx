'use client';

import { Button, Form, type FormGroupItemType, Icon } from '@lobehub/ui';
import { App } from 'antd';
import isEqual from 'fast-deep-equal';
import { HardDriveDownload, HardDriveUpload } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FORM_STYLE } from '@/const/layoutTokens';
import { DEFAULT_SETTINGS } from '@/const/settings';
import DataImporter from '@/features/DataImporter';
import { configService } from '@/services/config';
import { useChatStore } from '@/store/chat';
import { useUserStore } from '@/store/user';
import { settingsSelectors } from '@/store/user/selectors';

const AdvancedActions = () => {
  const { t } = useTranslation('setting');
  const [form] = Form.useForm();
  const { message, modal } = App.useApp();
  const [exporting, setExporting] = useState(false);
  const clearAllTopicsHistory = useChatStore((s) => s.clearAllTopicsHistory);
  const settings = useUserStore(settingsSelectors.currentSettings, isEqual);
  const [resetSettings] = useUserStore((s) => [s.resetSettings]);

  const handleClearTopics = useCallback(() => {
    modal.confirm({
      cancelText: t('cancel', { ns: 'common' }),
      centered: true,
      content: t('danger.clear.confirmDesc'),
      okButtonProps: {
        danger: true,
      },
      okText: t('danger.clear.action'),
      onOk: async () => {
        await clearAllTopicsHistory();

        message.success(t('danger.clear.success'));
      },
      title: t('danger.clear.confirm'),
    });
  }, [clearAllTopicsHistory, message, modal, t]);

  const handleReset = useCallback(() => {
    modal.confirm({
      centered: true,
      okButtonProps: { danger: true },
      onOk: () => {
        resetSettings();
        form.setFieldsValue(DEFAULT_SETTINGS);
        message.success(t('danger.reset.success'));
      },
      title: t('danger.reset.confirm'),
    });
  }, []);

  const system: FormGroupItemType = {
    children: [
      {
        children: (
          <DataImporter>
            <Button icon={<Icon icon={HardDriveDownload} />}>
              {t('storage.actions.import.button')}
            </Button>
          </DataImporter>
        ),
        label: t('storage.actions.import.title'),
        layout: 'horizontal',
        minWidth: undefined,
      },
      {
        children: (
          <Button
            icon={<Icon icon={HardDriveUpload} />}
            loading={exporting}
            onClick={async () => {
              setExporting(true);
              try {
                await configService.exportAll();
              } catch (error) {
                message.error(error instanceof Error ? error.message : String(error));
              } finally {
                setExporting(false);
              }
            }}
          >
            {t('storage.actions.export.button')}
          </Button>
        ),
        label: t('storage.actions.export.title'),
        layout: 'horizontal',
        minWidth: undefined,
      },
      {
        children: (
          <Button danger onClick={handleClearTopics} type={'primary'}>
            {t('danger.clear.action')}
          </Button>
        ),
        desc: t('danger.clear.desc'),
        label: t('danger.clear.title'),
        layout: 'horizontal',
        minWidth: undefined,
      },
      {
        children: (
          <Button danger onClick={handleReset} type={'primary'}>
            {t('danger.reset.action')}
          </Button>
        ),
        desc: t('danger.reset.desc'),
        label: t('danger.reset.title'),
        layout: 'horizontal',
        minWidth: undefined,
      },
    ],
    title: t('storage.actions.title'),
  };
  return (
    <Form
      form={form}
      initialValues={settings}
      items={[system]}
      itemsType={'group'}
      variant={'borderless'}
      {...FORM_STYLE}
    />
  );
};

export default AdvancedActions;
