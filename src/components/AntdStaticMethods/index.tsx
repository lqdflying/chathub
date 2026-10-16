// Entry component
import { App } from 'antd';
import type { MessageInstance } from 'antd/es/message/interface';
import type { ModalStaticFunctions } from 'antd/es/modal/confirm';
import type { NotificationInstance } from 'antd/es/notification/interface';
import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { setIosDownloadUi } from '@/utils/client/downloadFile';

let message: MessageInstance;
let notification: NotificationInstance;
let modal: Omit<ModalStaticFunctions, 'warn'>;

export default memo(() => {
  const staticFunction = App.useApp();
  message = staticFunction.message;
  modal = staticFunction.modal;
  notification = staticFunction.notification;
  const { t } = useTranslation('common');

  useEffect(() => {
    setIosDownloadUi({
      promptSave: (file) =>
        new Promise((resolve) => {
          modal.confirm({
            cancelText: t('cancel'),
            content: t('iosFileSave.content', { name: file.name }),
            okText: t('iosFileSave.ok'),
            onCancel: () => resolve(),
            onOk: async () => {
              try {
                await navigator.share({ files: [file] });
              } catch (error) {
                if (!(error instanceof DOMException && error.name === 'AbortError')) {
                  message.error(t('iosFileSave.failed'));
                }
              } finally {
                resolve();
              }
            },
            title: t('iosFileSave.title'),
          });
        }),
      reportError: (reason) => {
        message.error(
          t(reason === 'fetch_failed' ? 'iosFileSave.fetchFailed' : 'iosFileSave.failed'),
        );
      },
    });

    return () => setIosDownloadUi(undefined);
  }, [message, modal, t]);

  return null;
});

export { message, modal, notification };
