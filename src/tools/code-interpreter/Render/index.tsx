import {
  BuiltinRenderProps,
  CodeInterpreterParams,
  CodeInterpreterResponse,
  CodeInterpreterState,
} from '@lobechat/types';
import { Alert, Highlighter, Text } from '@lobehub/ui';
import { useTheme } from 'antd-style';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import BubblesLoading from '@/components/BubblesLoading';
import { useChatStore } from '@/store/chat';
import { chatToolSelectors } from '@/store/chat/slices/builtinTool/selectors';

import ResultFileGallery from './components/ResultFileGallery';

const CodeInterpreter = memo<
  BuiltinRenderProps<CodeInterpreterResponse, CodeInterpreterParams, CodeInterpreterState>
>(({ content, args, pluginState, messageId, apiName }) => {
  const { t } = useTranslation('tool');
  const theme = useTheme();

  const isExecuting = useChatStore(chatToolSelectors.isInterpreterExecuting(messageId));

  const error = pluginState?.error;
  const errorText =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : error
          ? JSON.stringify(error, null, 2)
          : undefined;

  // completed (has content) but nothing to show — distinguish "ran, no output"
  // from a broken/empty render
  const hasOutput = !!(content?.result || content?.output?.length || content?.files?.length);
  const showEmptyNote = !isExecuting && !error && !!content && !hasOutput;

  return (
    <Flexbox gap={12}>
      {/* 代码显示 */}
      <Flexbox>
        <Highlighter
          actionIconSize="small"
          language={apiName!}
          showLanguage={false}
          style={{ maxHeight: 200, overflow: 'scroll', width: '100%' }}
        >
          {args.code}
        </Highlighter>
      </Flexbox>

      {/* 执行状态 */}
      {isExecuting && (
        <Flexbox gap={8} horizontal>
          <BubblesLoading />
          <Text type="secondary">{t('codeInterpreter.executing')}</Text>
        </Flexbox>
      )}

      {/* 执行错误 */}
      {!isExecuting && errorText && (
        <Alert description={errorText} message={t('codeInterpreter.error')} showIcon type="error" />
      )}

      {/* 执行成功但没有任何输出 */}
      {showEmptyNote && <Text type="secondary">{t('codeInterpreter.noOutput')}</Text>}

      {!isExecuting && content && (
        <Flexbox gap={8}>
          {/* 返回值 */}
          {content.result && (
            <Flexbox>
              <Text strong style={{ marginBottom: 4 }}>
                {t('codeInterpreter.returnValue')}
              </Text>
              <Highlighter copyable={false} language="text" showLanguage={false}>
                {content.result}
              </Highlighter>
            </Flexbox>
          )}

          {/* 输出 */}
          {content?.output && content.output.length > 0 && (
            <Flexbox>
              <Text strong style={{ marginBottom: 4 }}>
                {t('codeInterpreter.output')}
              </Text>
              <div
                style={{
                  backgroundColor: theme.colorBgContainer,
                  border: `1px solid ${theme.colorBorder}`,
                  borderRadius: theme.borderRadius,
                  fontSize: 13,
                  lineHeight: 1.5,
                  overflow: 'auto',
                  padding: 12,
                  whiteSpace: 'pre',
                }}
              >
                {content.output?.map((item, index) => (
                  <Text code key={index} type={item.type === 'stderr' ? 'danger' : undefined}>
                    {item.data}
                  </Text>
                ))}
              </div>
            </Flexbox>
          )}

          {/* 文件显示 */}
          {content?.files && content.files.length > 0 && (
            <Flexbox>
              <Text strong style={{ marginBottom: 8 }}>
                {t('codeInterpreter.files')}
              </Text>
              <ResultFileGallery files={content.files} />
            </Flexbox>
          )}
        </Flexbox>
      )}
    </Flexbox>
  );
});

export default CodeInterpreter;
