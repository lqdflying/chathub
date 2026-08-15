import { t } from 'i18next';

/**
 * Warn that the assistant tool call could not be confirmed as saved (so no
 * tool was executed). An HTML 401/403 failure means a gateway (proxy, WAF,
 * expired access session) intercepted the save before it reached the server —
 * that case gets a specific, actionable description instead of the generic
 * "retry" one.
 */
export const notifyToolCallPersistenceFailure = async (failure?: {
  bodyKind: string;
  httpStatus?: number;
}) => {
  const { notification } = await import('@/components/AntdStaticMethods');
  const intercepted =
    failure?.bodyKind === 'html' && (failure.httpStatus === 401 || failure.httpStatus === 403);

  notification.warning({
    description: intercepted
      ? t('assistantToolCallPersistence.interceptedDescription', {
          ns: 'error',
          status: failure?.httpStatus,
        })
      : t('assistantToolCallPersistence.description', { ns: 'error' }),
    message: t('assistantToolCallPersistence.title', { ns: 'error' }),
  });
};
