import {
  ContextExportRequestContext,
  ContextExportRequestSnapshot,
  SendMessageServerParams,
  StructureOutputParams,
} from '@lobechat/types';
import { cleanObject } from '@lobechat/utils';

import { lambdaClient } from '@/libs/trpc/client';
import { createXorKeyVaultsPayload } from '@/services/_auth';

type GenerateJSONWithContextResult =
  | {
      result: unknown;
      snapshot: ContextExportRequestSnapshot;
      success: true;
    }
  | {
      error: { message: string };
      snapshot: ContextExportRequestSnapshot;
      success: false;
    };

class AiChatService {
  sendMessageInServer = async (
    params: SendMessageServerParams,
    abortController: AbortController,
  ) => {
    return lambdaClient.aiChat.sendMessageInServer.mutate(cleanObject(params), {
      context: { showNotification: false },
      signal: abortController?.signal,
    });
  };

  generateJSON = async (
    params: Omit<StructureOutputParams, 'keyVaultsPayload'>,
    abortController: AbortController,
  ) => {
    return lambdaClient.aiChat.outputJSON.mutate(
      { ...params, keyVaultsPayload: createXorKeyVaultsPayload(params.provider) },
      {
        context: { showNotification: false },
        signal: abortController?.signal,
      },
    );
  };

  generateJSONWithContext = async (
    params: Omit<StructureOutputParams, 'keyVaultsPayload'>,
    contextExportRequest: ContextExportRequestContext,
    abortController: AbortController,
  ): Promise<GenerateJSONWithContextResult> => {
    return lambdaClient.aiChat.outputJSONWithContext.mutate(
      {
        ...params,
        contextExportRequest,
        keyVaultsPayload: createXorKeyVaultsPayload(params.provider),
      },
      {
        context: { showNotification: false },
        signal: abortController?.signal,
      },
    );
  };

  // sendGroupMessageInServer = async (params: SendMessageServerParams) => {
  //   return lambdaClient.aiChat.sendGroupMessageInServer.mutate(cleanObject(params));
  // };
}

export const aiChatService = new AiChatService();
