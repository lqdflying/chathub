import type { LobeChatDatabase, Transaction } from '@lobechat/database';
import type {
  ChatToolPayload,
  ConversationGenerationConfigSnapshot,
  ConversationGenerationError,
  UIChatMessage,
} from '@lobechat/types';
import { nanoid } from '@lobechat/utils';
import { and, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';

import { ConversationGenerationModel } from '@/database/models/conversationGeneration';
import { MessageModel } from '@/database/models/message';
import { PluginModel } from '@/database/models/plugin';
import { SkillModel } from '@/database/models/skill';
import { agents, agentsToSessions } from '@/database/schemas';
import {
  appendFixedMemoryEntry,
  deleteFixedMemoryEntry,
  formatFixedMemoryEntries,
  updateFixedMemoryEntry,
} from '@/helpers/assistantMemory';
import { mcpService } from '@/server/services/mcp';
import { McpOAuthService } from '@/server/services/mcp/oauth';
import { SearchService } from '@/server/services/search';
import { CodeInterpreterIdentifier } from '@/tools/code-interpreter';
import { DalleManifest } from '@/tools/dalle';
import { MemoryApiName, MemoryManifest } from '@/tools/memory';
import { SkillLoaderApiName, SkillLoaderManifest } from '@/tools/skills';
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

export interface ConversationToolInvocationResult {
  content: string;
  inputHash: string;
  messageId?: string;
  metadata?: Record<string, unknown>;
  shouldContinue: boolean;
  state?: unknown;
  success: boolean;
}

const toToolError = (error: unknown): ConversationGenerationError => ({
  body: error instanceof Error ? { name: error.name } : undefined,
  message: error instanceof Error ? error.message : String(error),
  type: 'ToolExecutionError',
});

export const getConversationToolInputHash = (operationId: string, payload: ChatToolPayload) =>
  hashInput({
    apiName: payload.apiName,
    arguments: payload.arguments,
    identifier: payload.identifier,
    operationId,
    toolCallId: payload.id,
  });

const parseStepResult = (
  result: Record<string, unknown> | null | undefined,
  inputHash: string,
): ConversationToolInvocationResult | undefined => {
  if (!result || typeof result.content !== 'string') return;

  return {
    content: result.content,
    inputHash,
    messageId: typeof result.messageId === 'string' ? result.messageId : undefined,
    metadata:
      result.metadata && typeof result.metadata === 'object'
        ? (result.metadata as Record<string, unknown>)
        : undefined,
    shouldContinue: result.shouldContinue !== false,
    state: result.state,
    success: result.success !== false,
  };
};

const serializeStepResult = (result: ConversationToolInvocationResult) => ({
  content: result.content,
  ...(result.messageId ? { messageId: result.messageId } : {}),
  ...(result.metadata ? { metadata: result.metadata } : {}),
  shouldContinue: result.shouldContinue,
  ...(result.state === undefined ? {} : { state: result.state }),
  success: result.success,
});

const invokeMemoryTool = async ({
  assistantMessage,
  db,
  inputHash,
  payload,
  userId,
}: {
  assistantMessage: UIChatMessage;
  db: Transaction;
  inputHash: string;
  payload: ChatToolPayload;
  userId: string;
}): Promise<ConversationToolInvocationResult> => {
  const sessionId = assistantMessage.sessionId;
  if (!sessionId) {
    return {
      content: JSON.stringify({ error: 'Memory writes require an assistant session.' }),
      inputHash,
      shouldContinue: true,
      success: false,
    };
  }

  const [agent] = await db
    .select({ fixedMemory: agents.fixedMemory, id: agents.id })
    .from(agentsToSessions)
    .innerJoin(agents, and(eq(agents.id, agentsToSessions.agentId), eq(agents.userId, userId)))
    .where(and(eq(agentsToSessions.sessionId, sessionId), eq(agentsToSessions.userId, userId)))
    .for('update')
    .limit(1);
  if (!agent) {
    return {
      content: JSON.stringify({ error: 'The assistant for this memory write was not found.' }),
      inputHash,
      shouldContinue: true,
      success: false,
    };
  }

  const args = parseArgs(payload.arguments);
  let content: Record<string, unknown>;
  let nextDocument: string | undefined;

  if (payload.apiName === MemoryApiName.saveMemory) {
    const value = typeof args.content === 'string' ? args.content.trim() : '';
    if (!value) {
      content = { error: 'saveMemory requires non-empty content' };
    } else {
      const outcome = appendFixedMemoryEntry(agent.fixedMemory, value);
      nextDocument = outcome.doc;
      content = { content: value, index: outcome.index, saved: true };
    }
  } else if (payload.apiName === MemoryApiName.updateMemory) {
    const index = Number(args.index);
    const match = typeof args.match === 'string' ? args.match.trim() : '';
    const value = typeof args.content === 'string' ? args.content.trim() : '';
    if (!Number.isInteger(index) || !match || !value) {
      content = { error: 'updateMemory requires index, match, and content' };
    } else {
      const outcome = updateFixedMemoryEntry(agent.fixedMemory, index, match, value);
      if ('error' in outcome) {
        content = {
          currentEntries: formatFixedMemoryEntries(outcome.entries),
          error: outcome.error,
        };
      } else {
        nextDocument = outcome.doc;
        content = { content: outcome.entry.content, index, updated: true };
      }
    }
  } else if (payload.apiName === MemoryApiName.deleteMemory) {
    const index = Number(args.index);
    const match = typeof args.match === 'string' ? args.match.trim() : '';
    if (!Number.isInteger(index) || !match) {
      content = { error: 'deleteMemory requires index and match' };
    } else {
      const outcome = deleteFixedMemoryEntry(agent.fixedMemory, index, match);
      if ('error' in outcome) {
        content = {
          currentEntries: formatFixedMemoryEntries(outcome.entries),
          error: outcome.error,
        };
      } else {
        nextDocument = outcome.doc;
        content = { deleted: true, index, renumbered: true };
      }
    }
  } else {
    content = { error: `Unknown memory operation "${payload.apiName}".` };
  }

  if (nextDocument !== undefined) {
    await db
      .update(agents)
      .set({ fixedMemory: nextDocument, updatedAt: new Date() })
      .where(and(eq(agents.id, agent.id), eq(agents.userId, userId)));
  }

  return {
    content: JSON.stringify(content),
    inputHash,
    shouldContinue: true,
    success: !('error' in content),
  };
};

export const invokeConversationTool = async ({
  assistantMessage,
  db,
  inputHash,
  payload,
  userId,
}: {
  assistantMessage: UIChatMessage;
  db: LobeChatDatabase;
  inputHash: string;
  payload: ChatToolPayload;
  userId: string;
}): Promise<ConversationToolInvocationResult> => {
  const messageModel = new MessageModel(db, userId);
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
      content: JSON.stringify({
        error: 'Memory execution was not serialized with its durable step.',
      }),
      inputHash,
      shouldContinue: false,
      success: false,
    };
  }

  if (identifier === DalleManifest.identifier) {
    return {
      content: JSON.stringify({
        error: 'Image generation requires a connected browser for this conversation.',
      }),
      inputHash,
      shouldContinue: false,
      success: false,
    };
  }

  if (identifier === SkillLoaderManifest.identifier) {
    const skillIdentifier = typeof args.name === 'string' ? args.name : '';
    const skill = skillIdentifier
      ? await new SkillModel(db, userId).findById(skillIdentifier)
      : undefined;
    if (payload.apiName !== SkillLoaderApiName || !skill) {
      return {
        content: JSON.stringify({ error: 'The requested skill is not installed.' }),
        inputHash,
        shouldContinue: true,
        success: false,
      };
    }
    return {
      content: JSON.stringify({
        contentHash: skill.contentHash,
        identifier: skill.identifier,
        name: skill.name,
        status: 'loaded',
      }),
      inputHash,
      metadata: { skills: { activated: [skill.identifier] } },
      shouldContinue: true,
      success: true,
    };
  }

  const plugin = await new PluginModel(db, userId).findById(identifier);
  const mcp = plugin?.customParams?.mcp as
    { auth?: any; headers?: Record<string, string>; type?: string; url?: string } | undefined;

  if (mcp?.type === 'http' && mcp.url) {
    const invocationId = `mi_${inputHash.slice(0, 20) || nanoid(20)}`;
    const existingToolMessage = await messageModel.findToolMessageByCall(
      assistantMessage.id,
      payload.id,
    );
    const toolMessage =
      existingToolMessage ||
      (await messageModel.create({
        content: '',
        groupId: assistantMessage.groupId,
        parentId: assistantMessage.id,
        plugin: payload,
        role: 'tool',
        sessionId: assistantMessage.sessionId ?? assistantMessage.groupId ?? '',
        threadId: assistantMessage.threadId,
        tool_call_id: payload.id,
        topicId: assistantMessage.topicId,
      }));
    const recovered = await messageModel.recoverPersistedMCPResult(toolMessage.id);
    if (recovered) {
      return {
        content: recovered.content,
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
    try {
      const data = await mcpService.callTool(
        params,
        payload.apiName,
        payload.arguments,
        oauthContext,
      );
      const content = stringifyToolResult(data);
      const persisted = await messageModel.persistMCPResult(toolMessage.id, invocationId, content);
      if (!persisted) throw new Error('MCP result was superseded before it could be persisted.');
      await messageModel.updatePluginError(toolMessage.id, null);
      return {
        content,
        inputHash,
        messageId: toolMessage.id,
        shouldContinue: true,
        success: true,
      };
    } catch (error) {
      const normalized = toToolError(error);
      const content = JSON.stringify({ error: normalized.message, type: normalized.type });
      const persisted = await messageModel.persistMCPResult(toolMessage.id, invocationId, content);
      if (!persisted) throw error;
      await messageModel.updatePluginError(toolMessage.id, normalized);
      return {
        content,
        inputHash,
        messageId: toolMessage.id,
        shouldContinue: true,
        success: false,
      };
    }
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

export const executeConversationToolStep = async ({
  assistantMessage,
  attempt,
  db,
  operationId,
  payload,
  userId,
}: {
  assistantMessage: UIChatMessage;
  attempt: number;
  db: LobeChatDatabase;
  operationId: string;
  payload: ChatToolPayload;
  userId: string;
}): Promise<ConversationToolInvocationResult> => {
  const inputHash = getConversationToolInputHash(operationId, payload);
  const model = new ConversationGenerationModel(db, userId);
  const completed = await model.findCompletedStepByHash(operationId, inputHash);
  const replay = parseStepResult(completed?.result, inputHash);
  if (replay) return replay;

  const execute = async (database: LobeChatDatabase | Transaction) => {
    const stepModel = new ConversationGenerationModel(database, userId);
    const step = await stepModel.claimStep({
      attempt,
      inputHash,
      kind: `tool:${payload.identifier}:${payload.apiName}`,
      operationId,
    });
    if (!step) throw new Error('Conversation tool step could not be claimed.');

    try {
      const result =
        payload.identifier === MemoryManifest.identifier
          ? await invokeMemoryTool({
              assistantMessage,
              db: database as Transaction,
              inputHash,
              payload,
              userId,
            })
          : await invokeConversationTool({
              assistantMessage,
              db: database as LobeChatDatabase,
              inputHash,
              payload,
              userId,
            });
      await stepModel.updateStep(step.id, {
        finishedAt: new Date(),
        result: serializeStepResult(result),
        status: 'succeeded',
      });
      return result;
    } catch (error) {
      await stepModel.updateStep(step.id, {
        error: toToolError(error),
        finishedAt: new Date(),
        status: 'failed',
      });
      throw error;
    }
  };

  if (payload.identifier === MemoryManifest.identifier) {
    return db.transaction((transaction) => execute(transaction));
  }
  return execute(db);
};

export const findUnsupportedConversationTool = async ({
  config,
  db,
  userId,
}: {
  config: ConversationGenerationConfigSnapshot;
  db: LobeChatDatabase;
  userId: string;
}): Promise<{ identifier: string; reason: string } | undefined> => {
  const allowedBuiltins = new Set([
    MemoryManifest.identifier,
    SkillLoaderManifest.identifier,
    WebBrowsingManifest.identifier,
  ]);
  const pluginIds = [...new Set(config.plugins || [])];
  for (const identifier of pluginIds) {
    if (allowedBuiltins.has(identifier)) continue;
    if (identifier === DalleManifest.identifier || identifier === CodeInterpreterIdentifier) {
      return {
        identifier,
        reason: 'This tool currently requires the browser execution runtime.',
      };
    }

    const plugin = await new PluginModel(db, userId).findById(identifier);
    const mcp = plugin?.customParams?.mcp as { type?: string; url?: string } | undefined;
    if (mcp?.type !== 'http' || !mcp.url) {
      return {
        identifier,
        reason: plugin
          ? 'Only HTTP MCP plugins can run in the durable server worker.'
          : 'The durable server worker does not recognize this tool.',
      };
    }
  }
};
