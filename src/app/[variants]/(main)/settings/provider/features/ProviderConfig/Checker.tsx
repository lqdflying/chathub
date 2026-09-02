'use client';

import { CheckCircleFilled } from '@ant-design/icons';
import { ChatMessageError, TraceNameMap } from '@lobechat/types';
import { Alert, Button, Highlighter, Icon, Select } from '@lobehub/ui';
import { useTheme } from 'antd-style';
import { Loader2Icon } from 'lucide-react';
import { ReactNode, memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { ModelBrandIcon } from '@/components/ProviderBrandIcon';
import { CURRENT_VERSION } from '@/const/version';
import { useProviderName } from '@/hooks/useProviderName';
import { chatService } from '@/services/chat';
import type { JsonChatCompletionInspection } from '@/services/chat/extractJsonChatCompletion';
import { aiModelSelectors, aiProviderSelectors, useAiInfraStore } from '@/store/aiInfra';

import {
  buildConnectionCheckParams,
  hasConnectionCheckResult,
  hasSuccessfulConnectionCheck,
} from './connectionCheckParams';

export { hasConnectionCheckOutput, hasConnectionCheckResult } from './connectionCheckParams';

const Error = memo<{ error: ChatMessageError }>(({ error }) => {
  const { t } = useTranslation('error');
  const providerName = useProviderName(error.body?.provider);

  return (
    <Flexbox gap={8} style={{ maxWidth: 600, width: '100%' }}>
      <Alert
        extra={
          <Flexbox>
            <Highlighter
              actionIconSize={'small'}
              language={'json'}
              variant={'borderless'}
              wrap={true}
            >
              {JSON.stringify(error.body || error, null, 2)}
            </Highlighter>
          </Flexbox>
        }
        message={t(`response.${error.type}` as any, { provider: providerName })}
        showIcon
        type={'error'}
      />
    </Flexbox>
  );
});

export type CheckErrorRender = (props: {
  defaultError: ReactNode;
  error?: ChatMessageError;
  setError: (error?: ChatMessageError) => void;
}) => ReactNode;

export const resolveConnectionCheckModel = (selectedModel: string | undefined, fallback: string) =>
  selectedModel?.trim() || fallback;

interface ConnectionCheckerProps {
  checkErrorRender?: CheckErrorRender;
  model: string;
  onAfterCheck: () => Promise<void>;
  onBeforeCheck: () => Promise<void>;
  provider: string;
}

const Checker = memo<ConnectionCheckerProps>(
  ({ model, provider, checkErrorRender: CheckErrorRender, onBeforeCheck, onAfterCheck }) => {
    const { t } = useTranslation('setting');

    const isProviderConfigUpdating = useAiInfraStore(
      aiProviderSelectors.isProviderConfigUpdating(provider),
    );
    const totalModels = useAiInfraStore(aiModelSelectors.aiProviderChatModelListIds);
    const updateAiProviderConfig = useAiInfraStore((s) => s.updateAiProviderConfig);
    const currentConfig = useAiInfraStore(aiProviderSelectors.providerConfigById(provider));

    const [loading, setLoading] = useState(false);
    const [pass, setPass] = useState(false);
    const [checkModel, setCheckModel] = useState(model);

    const theme = useTheme();
    const [error, setError] = useState<ChatMessageError | undefined>();

    useEffect(() => {
      setCheckModel((prev) => {
        if (prev === model) return prev;
        setPass(false);
        setError(undefined);
        return model;
      });
    }, [model]);

    const connectionCheckFailedError = (body?: Record<string, unknown>): ChatMessageError => ({
      body: {
        clientVersion: CURRENT_VERSION,
        ...body,
      },
      message: t('response.ConnectionCheckFailed', { ns: 'error' }),
      type: 'ConnectionCheckFailed',
    });

    const withClientVersion = (nextError: ChatMessageError): ChatMessageError => ({
      ...nextError,
      body:
        nextError.body && typeof nextError.body === 'object' && !Array.isArray(nextError.body)
          ? { ...nextError.body, clientVersion: CURRENT_VERSION }
          : { clientVersion: CURRENT_VERSION, providerBody: nextError.body },
    });

    const checkConnection = async () => {
      const activeCheckModel = resolveConnectionCheckModel(checkModel, model);

      // Clear previous check results immediately
      setPass(false);
      setError(undefined);

      let isError = false;
      let settled: 'pass' | 'fail' | null = null;
      // JSON Check is the primary path. SSE abort handlers remain for runtimes
      // that ignore responseMode json and still wrap as text/event-stream.
      let reasoningContent = '';
      let jsonInspection: JsonChatCompletionInspection | undefined;

      const settlePass = () => {
        settled = 'pass';
        setError(undefined);
        setPass(true);
      };

      const settleFail = (nextError: ChatMessageError) => {
        settled = 'fail';
        setPass(false);
        setError(nextError);
      };

      const applyConnectionResult = (value: unknown, reasoning?: { content?: string }) => {
        if (
          !isError &&
          hasSuccessfulConnectionCheck(provider, value, reasoning, jsonInspection?.completed)
        ) {
          settlePass();
        } else {
          settleFail(
            connectionCheckFailedError({
              reason: jsonInspection
                ? 'json_completion_empty_or_incomplete'
                : 'connection_check_empty',
              response: jsonInspection?.summary,
              result: {
                reasoningLength: reasoning?.content?.length ?? 0,
                textLength: typeof value === 'string' ? value.length : 0,
                textType: value === null ? 'null' : typeof value,
              },
            }),
          );
        }
      };

      await chatService.fetchPresetTaskResult({
        onAbort: async (value, interrupt) => {
          // Safari/WebKit often ends a completed SSE with TypeError "Load failed"
          // after MiniMax already returned hello (Axiom). Prefer interrupt.reasoning
          // over the 300ms message buffer. If both are empty, do NOT settleFail —
          // fetchSSE may still recover via response.clone().text() and onFinish.
          const reasoningAtAbort = interrupt?.reasoning || reasoningContent;
          if (hasConnectionCheckResult(value, { content: reasoningAtAbort })) {
            settlePass();
          }
        },
        onError: (_, rawError) => {
          // Do not wipe a prior pass/fail (e.g. clone().text() throw after abort).
          if (settled) return;
          isError = true;
          settleFail(rawError ? withClientVersion(rawError) : connectionCheckFailedError());
        },
        onFinish: async (value, context) => {
          // Prefer a prior onAbort *pass* (content already seen). Empty abort
          // leaves settled null so recovery text can still pass here.
          if (settled) return;
          applyConnectionResult(value, context?.reasoning);
        },
        onJsonResponse: (inspection) => {
          jsonInspection = inspection;
        },
        onLoadingChange: (nextLoading) => {
          setLoading(nextLoading);
        },
        onMessageHandle: (chunk) => {
          if (chunk.type === 'reasoning' && typeof chunk.text === 'string') {
            reasoningContent += chunk.text;
          }
        },
        params: buildConnectionCheckParams(provider, activeCheckModel),
        responseAnimation: { text: 'none' },
        trace: {
          sessionId: `connection:${provider}`,
          topicId: activeCheckModel,
          traceName: TraceNameMap.ConnectivityChecker,
        },
      });

      // Guarantee visible feedback: server can succeed while the browser drops
      // onFinish (observed on Safari iOS for MiniMax Connectivity Check).
      if (!settled) {
        settleFail(
          connectionCheckFailedError({
            reason: 'no_client_result',
          }),
        );
      }
    };

    const defaultError = error ? <Error error={error as ChatMessageError} /> : null;

    const errorContent = CheckErrorRender ? (
      <CheckErrorRender defaultError={defaultError} error={error} setError={setError} />
    ) : (
      defaultError
    );

    return (
      <Flexbox gap={8}>
        <Flexbox gap={8} horizontal>
          <Select
            listItemHeight={36}
            onSelect={async (value) => {
              setCheckModel(value);
              setPass(false);
              setError(undefined);
              await updateAiProviderConfig(provider, {
                ...currentConfig,
                checkModel: value,
              });
            }}
            optionRender={({ value }) => {
              return (
                <Flexbox align={'center'} gap={6} horizontal>
                  <ModelBrandIcon model={value as string} size={20} />
                  {value}
                </Flexbox>
              );
            }}
            options={totalModels.map((id) => ({ label: id, value: id }))}
            style={{
              flex: 1,
              overflow: 'hidden',
            }}
            suffixIcon={isProviderConfigUpdating && <Icon icon={Loader2Icon} spin />}
            value={checkModel}
            virtual
          />
          <Button
            disabled={isProviderConfigUpdating && !loading}
            loading={loading}
            onClick={async () => {
              setLoading(true);
              setPass(false);
              setError(undefined);
              try {
                await onBeforeCheck();
                await checkConnection();
              } catch (e) {
                setPass(false);
                setError(
                  connectionCheckFailedError({
                    message: e instanceof Error ? e.message : String(e),
                    reason: 'check_threw',
                  }),
                );
              } finally {
                setLoading(false);
                await onAfterCheck();
              }
            }}
          >
            {t('llm.checker.button')}
          </Button>
        </Flexbox>

        {pass && (
          <Flexbox gap={4} horizontal>
            <CheckCircleFilled
              style={{
                color: theme.colorSuccess,
              }}
            />
            {t('llm.checker.pass')}
          </Flexbox>
        )}
        {error && errorContent}
      </Flexbox>
    );
  },
);

export default Checker;
