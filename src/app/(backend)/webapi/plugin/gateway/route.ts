import { AgentRuntimeError } from '@lobechat/model-runtime';
import { ChatErrorType, ErrorType, TraceNameMap } from '@lobechat/types';
import { getXorPayload } from '@lobechat/utils/server';
import { PluginRequestPayload } from '@lobehub/chat-plugin-sdk';
import { createGatewayOnEdgeRuntime } from '@lobehub/chat-plugins-gateway';

import { resolveWebApiAuth } from '@/app/(backend)/middleware/auth/utils';
import { LOBE_CHAT_AUTH_HEADER, enableAuth } from '@/const/auth';
import { LOBE_CHAT_TRACE_ID } from '@/const/trace';
import { getAppConfig } from '@/envs/app';
import { TraceClient } from '@/libs/traces';
import { createErrorResponse } from '@/utils/errorResponse';
import { getTracePayload } from '@/utils/trace';

import { parserPluginSettings } from './settings';

const { PLUGINS_INDEX_URL: pluginsIndexUrl, PLUGIN_SETTINGS } = getAppConfig();

const defaultPluginSettings = parserPluginSettings(PLUGIN_SETTINGS);

const handler = createGatewayOnEdgeRuntime({ defaultPluginSettings, pluginsIndexUrl });

export const POST = async (req: Request) => {
  // get Authorization from header
  const authorization = req.headers.get(LOBE_CHAT_AUTH_HEADER);
  if (!authorization) throw AgentRuntimeError.createError(ChatErrorType.Unauthorized);

  const payload = getXorPayload(authorization);

  if (enableAuth || PLUGIN_SETTINGS) {
    try {
      await resolveWebApiAuth(req, { accessCode: payload.accessCode });
    } catch (error) {
      const errorType =
        (error as { errorType?: ErrorType }).errorType ?? ChatErrorType.InternalServerError;
      return createErrorResponse(errorType, error);
    }
  }

  // TODO: need to be replace by better telemetry system
  // add trace
  const tracePayload = getTracePayload(req);
  const traceClient = new TraceClient();
  const trace = traceClient.createTrace({
    id: tracePayload?.traceId,
    ...tracePayload,
  });

  const { manifest, indexUrl, ...input } = (await req.clone().json()) as PluginRequestPayload;

  const span = trace?.span({
    input,
    metadata: { indexUrl, manifest },
    name: TraceNameMap.FetchPluginAPI,
  });

  span?.update({ parentObservationId: tracePayload?.observationId });

  const res = await handler(req);

  span?.end({ output: await res.clone().text() });

  if (trace?.id) {
    res.headers.set(LOBE_CHAT_TRACE_ID, trace.id);
  }

  return res;
};
