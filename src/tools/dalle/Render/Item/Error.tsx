import { Alert, Button, Highlighter } from '@lobehub/ui';
import { LucideRefreshCw } from 'lucide-react';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { useChatStore } from '@/store/chat';
import { chatSelectors } from '@/store/chat/selectors';

interface ErrorProps {
  index: number;
  messageId: string;
}

const Error = memo<ErrorProps>(({ messageId, index }) => {
  const { t } = useTranslation('error');
  const { t: ct } = useTranslation('common');
  const { t: tt } = useTranslation('tool');

  const error = useChatStore(
    (s) => chatSelectors.getMessageById(messageId)(s)?.pluginState?.['error']?.[index],
  ) as { body?: unknown; errorType?: string; message?: string } | Error | undefined;

  const [retryDallEImages] = useChatStore((s) => [s.retryDallEImages]);

  if (!error) return null;

  // Errors arrive in three shapes: a backend payload (has errorType), a plain
  // Error (has message), or a non-JSON body. Render a meaningful title + detail
  // for each rather than "[object Object]" / "response.undefined".
  const errorType = (error as { errorType?: string }).errorType;
  const message = (error as { message?: string }).message;
  const body = (error as { body?: unknown }).body;

  const title =
    errorType === 'NoImageModelConfigured'
      ? tt('dalle.noImageModel')
      : errorType === 'ChatImageTaskUnverified'
        ? tt('dalle.taskUnverified')
        : errorType === 'ChatImageTaskCancelled'
          ? tt('dalle.taskCancelled')
          : errorType
            ? t(`response.${errorType}` as any, { defaultValue: errorType })
            : (message ?? t('response.PluginServerError' as any));

  const detail = body ?? message ?? error;

  return (
    <Flexbox gap={12}>
      <Alert
        extra={
          <Highlighter actionIconSize={'small'} language={'json'}>
            {typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2)}
          </Highlighter>
        }
        extraDefaultExpand
        message={title}
        type={'error'}
      />
      <Button icon={LucideRefreshCw} onClick={() => retryDallEImages(messageId)} type={'primary'}>
        {ct('retry')}
      </Button>
    </Flexbox>
  );
});

export default Error;
