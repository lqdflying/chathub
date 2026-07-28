import {
  AgentRuntimeError,
  ChatCompletionErrorPayload,
  ModelRuntime,
} from '@lobechat/model-runtime';
import { ChatErrorType, ClientSecretPayload } from '@lobechat/types';
import { getXorPayload } from '@lobechat/utils/server';

import { LOBE_CHAT_AUTH_HEADER } from '@/const/auth';
import { createErrorResponse } from '@/utils/errorResponse';

import { resolveWebApiAuth } from './utils';

type CreateRuntime = (jwtPayload: ClientSecretPayload) => ModelRuntime;
type RequestOptions = { createRuntime?: CreateRuntime; params: Promise<{ provider: string }> };

export type RequestHandler = (
  req: Request,
  options: RequestOptions & {
    createRuntime?: CreateRuntime;
    jwtPayload: ClientSecretPayload;
  },
) => Promise<Response>;

export const checkAuth =
  (handler: RequestHandler) => async (req: Request, options: RequestOptions) => {
    // we have a special header to debug the api endpoint in development mode
    const isDebugApi = req.headers.get('lobe-auth-dev-backend-api') === '1';
    if (process.env.NODE_ENV === 'development' && isDebugApi) {
      return handler(req, { ...options, jwtPayload: { userId: 'DEV_USER' } });
    }

    let jwtPayload: ClientSecretPayload;

    try {
      // get Authorization from header
      const authorization = req.headers.get(LOBE_CHAT_AUTH_HEADER);

      if (!authorization) throw AgentRuntimeError.createError(ChatErrorType.Unauthorized);

      jwtPayload = getXorPayload(authorization);

      const authResult = await resolveWebApiAuth(req, {
        accessCode: jwtPayload.accessCode,
        apiKey: jwtPayload.apiKey,
      });

      if ('userId' in authResult) {
        jwtPayload = {
          ...jwtPayload,
          userId: authResult.userId,
        };
      }
    } catch (e) {
      const params = await options.params;

      // if the error is not a ChatCompletionErrorPayload, it means the application error
      if (!(e as ChatCompletionErrorPayload).errorType) {
        if ((e as any).code === 'ERR_JWT_EXPIRED')
          return createErrorResponse(ChatErrorType.SystemTimeNotMatchError, e);

        // other issue will be internal server error
        console.error(e);
        return createErrorResponse(ChatErrorType.InternalServerError, {
          error: e,
          provider: params?.provider,
        });
      }

      const {
        errorType = ChatErrorType.InternalServerError,
        error: errorContent,
        ...res
      } = e as ChatCompletionErrorPayload;

      const error = errorContent || e;

      return createErrorResponse(errorType, { error, ...res, provider: params?.provider });
    }

    return handler(req, { ...options, jwtPayload });
  };
