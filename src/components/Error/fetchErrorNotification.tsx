import { FluentEmoji } from '@lobehub/ui';
import { t } from 'i18next';

import { notification } from '@/components/AntdStaticMethods';

import Description from './Description';

export const fetchErrorNotification = {
  error: ({
    errorMessage,
    key,
    status,
  }: {
    errorMessage: string;
    key?: string;
    status?: number;
  }) => {
    notification.error({
      description: <Description message={errorMessage} status={status} />,
      icon: <FluentEmoji emoji={'🤧'} size={24} />,
      key,
      message: t('fetchError.title', { ns: 'error' }),
      type: 'error',
    });
  },
};
