import { createHash } from 'node:crypto';

import type { ChatToolPayload, UIChatMessage } from '@lobechat/types';
import { nanoid } from '@lobechat/utils';
import type { LobeChatDatabase } from '@lobechat/database';

import { MessageModel } from '@/database/models/message';
import { PluginModel } from '@/database/models/plugin';
import { mcpService } from '@/server/services/mcp';
import { McpOAuthService } from '@/server/services/mcp/oauth';
import { SearchService } from '@/server/services/search';
import { DalleManifest } from '@/tools/dalle';
import { MemoryManifest } from '@/tools/memory';
import { SkillLoaderManifest } from '@/tools/skills';
import { WebBrowsingApiName, WebBrowsingManifest } from '@/tools/web-browsing';
import { WebBrowsingExecutionRuntime } from '@/tools/web-browsing/ExecutionRuntime';

const searchRuntime = new WebBrowsingExecutionRuntime({ searchService: new SearchService() });

const hashInput = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

const stringifyToolResult = (value: unknown) =>
  typeof value === 'string' ? value : JSON.stringify(value ?? '');

const parseArgs = (value?: string) => {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
};

export const invokeConversationTool = async ({
  assistantMessage,
  db,
  payload,
  userId,
}: {
  assistantMessage: UIChatMessage;
  db: LobeChatDatabase;
  payload: ChatToolPayload;
  userId: string;
}) => {
  const messageModel = new MessageModel(db, userId);
  const inputHash = hashInput({
    arguments: payload.arguments,
    identifier: payload.identifier,
    name: payload.apiName,
  });
  const identifier = payload.identifier;
  const args = parseArgs(payload.arguments);

  if (identifier === WebBrowsingManifest.identifier) {
    let result;
    if (payload.apiName === WebBrowsingApiName.search) {
      result = await searchRuntime.search(args);
    } else if (payload.apiName === WebBrowsingApiName.crawlSinglePage) {
      result = await searchRuntime.crawlSinglePage(args);
    } else {
      result = await searchRuntime.crawlMultiPages(args);
    }
    return {
      content: result.content,
      inputHash,
      shouldContinue: result.success !== false,
      state: result.state,
      success: result.success !== false,
    };
  }

  if (identifier === MemoryManifest.identifier) {
    return {
      content: JSON.stringify({ acknowledged: true, ...args }),
      inputHash,
      shouldContinue: true,
      success: true,
    };
  }

  if (identifier === DalleManifest.identifier) {
    return {
      content: JSON.stringify({
        prompts: args.prompts || [],
        status: 'queued',
      }),
      inputHash,
      shouldContinue: true,
      success: true,
    };
  }

  if (identifier === SkillLoaderManifest.identifier) {
    return {
      content: JSON.stringify({
        identifier: args.identifier,
        name: args.identifier,
        status: 'loaded',
      }),
      inputHash,
      shouldContinue: true,
      success: true,
    };
  }

  const plugin = await new PluginModel(db, userId).findById(identifier);
  const mcp = plugin?.customParams?.mcp as
    | { auth?: any; headers?: Record<string, string>; type?: string; url?: string }
    | undefined;

  if (mcp?.type === 'http' && mcp.url) {
    const invocationId = `mi_${nanoid(20)}`;
    const toolMessage = await messageModel.create({
      content: '',
      groupId: assistantMessage.groupId,
      parentId: assistantMessage.id,
      plugin: payload,
      role: 'tool',
      sessionId: assistantMessage.sessionId ?? assistantMessage.groupId ?? '',
      threadId: assistantMessage.threadId,
      tool_call_id: payload.id,
      topicId: assistantMessage.topicId,
    });
    const recovered = await messageModel.recoverMCPResult(toolMessage.id, invocationId);
    if (recovered) {
      const existing = await messageModel.findById(toolMessage.id);
      return {
        content: existing?.content || '',
        inputHash,
        messageId: toolMessage.id,
        shouldContinue: true,
        success: true,
      };
    }

    await messageModel.beginMCPResultInvocation(toolMessage.id, invocationId);
    const oauthService = new McpOAuthService(db);
    const oauthContext = {
      oauthService,
      pluginIdentifier: identifier,
      userId,
    };
    const token = await oauthService.getOAuthToken(userId, identifier);
    const params = {
      auth: token?.accessToken
        ? { ...mcp.auth, accessToken: token.accessToken, type: mcp.auth?.type || 'oauth2' }
        : mcp.auth,
      headers: mcp.headers,
      name: identifier,
      type: 'http' as const,
      url: mcp.url,
    };
    const data = await mcpService.callTool(params, payload.apiName, payload.arguments, oauthContext);
    const content = stringifyToolResult(data);
    await messageModel.persistMCPResult(toolMessage.id, invocationId, content);
    return {
      content,
      inputHash,
      messageId: toolMessage.id,
      shouldContinue: true,
      success: true,
    };
  }

  if (plugin) {
    return {
      content: JSON.stringify({
        error: 'This plugin cannot be executed on the server. Re-run it from a connected client.',
        identifier,
      }),
      inputHash,
      shouldContinue: false,
      success: false,
    };
  }

  return {
    content: JSON.stringify({
      error: `Unknown tool "${identifier}" was not re-invoked because it may have side effects.`,
      identifier,
    }),
    inputHash,
    shouldContinue: false,
    success: false,
  };
};
