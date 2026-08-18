/** @vitest-environment node */
import type { ChatToolPayload, UIChatMessage } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DalleManifest } from '@/tools/dalle';
import { MemoryApiName, MemoryManifest } from '@/tools/memory';
import { CodeInterpreterIdentifier } from '@/tools/code-interpreter';
import { WebBrowsingApiName, WebBrowsingManifest } from '@/tools/web-browsing';

import { executeConversationToolStep, findUnsupportedConversationTool } from './tools';

const generationMocks = vi.hoisted(() => ({
  claimStep: vi.fn(),
  findCompletedStepByHash: vi.fn(),
  updateStep: vi.fn(),
}));
const messageMocks = vi.hoisted(() => ({
  beginMCPResultInvocation: vi.fn(),
  create: vi.fn(),
  findToolMessageByCall: vi.fn(),
  persistMCPResult: vi.fn(),
  recoverPersistedMCPResult: vi.fn(),
  update: vi.fn(),
  updatePluginError: vi.fn(),
  updatePluginState: vi.fn(),
}));
const searchMocks = vi.hoisted(() => ({
  crawlMultiPages: vi.fn(),
  crawlSinglePage: vi.fn(),
  search: vi.fn(),
}));
const pluginMocks = vi.hoisted(() => ({ findById: vi.fn() }));
const skillMocks = vi.hoisted(() => ({ findById: vi.fn() }));
const mcpMocks = vi.hoisted(() => ({ callTool: vi.fn() }));

vi.mock('@/database/models/conversationGeneration', () => ({
  ConversationGenerationModel: class {
    claimStep = generationMocks.claimStep;
    findCompletedStepByHash = generationMocks.findCompletedStepByHash;
    updateStep = generationMocks.updateStep;
  },
}));
vi.mock('@/database/models/message', () => ({
  MessageModel: class {
    beginMCPResultInvocation = messageMocks.beginMCPResultInvocation;
    create = messageMocks.create;
    findToolMessageByCall = messageMocks.findToolMessageByCall;
    persistMCPResult = messageMocks.persistMCPResult;
    recoverPersistedMCPResult = messageMocks.recoverPersistedMCPResult;
    update = messageMocks.update;
    updatePluginError = messageMocks.updatePluginError;
    updatePluginState = messageMocks.updatePluginState;
  },
}));
vi.mock('@/database/models/plugin', () => ({
  PluginModel: class {
    findById = pluginMocks.findById;
  },
}));
vi.mock('@/database/models/skill', () => ({
  SkillModel: class {
    findById = skillMocks.findById;
  },
}));
vi.mock('@/server/services/mcp', () => ({ mcpService: { callTool: mcpMocks.callTool } }));
vi.mock('@/server/services/mcp/oauth', () => ({
  McpOAuthService: class {
    getOAuthToken = vi.fn().mockResolvedValue(undefined);
  },
}));
vi.mock('@/server/services/search', () => ({ SearchService: class {} }));
vi.mock('@/tools/web-browsing/ExecutionRuntime', () => ({
  WebBrowsingExecutionRuntime: class {
    crawlMultiPages = searchMocks.crawlMultiPages;
    crawlSinglePage = searchMocks.crawlSinglePage;
    search = searchMocks.search;
  },
}));

const assistantMessage = {
  id: 'assistant-1',
  role: 'assistant',
  sessionId: 'session-1',
  topicId: 'topic-1',
} as UIChatMessage;

const payload = (overrides: Partial<ChatToolPayload> = {}): ChatToolPayload =>
  ({
    apiName: 'run',
    arguments: '{}',
    id: 'tool-call-1',
    identifier: 'plugin-1',
    type: 'default',
    ...overrides,
  }) as ChatToolPayload;

describe('executeConversationToolStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generationMocks.findCompletedStepByHash.mockResolvedValue(undefined);
    generationMocks.claimStep.mockResolvedValue({ id: 'step-1' });
    generationMocks.updateStep.mockResolvedValue({ id: 'step-1' });
    messageMocks.create.mockResolvedValue({ id: 'tool-message-1' });
    messageMocks.findToolMessageByCall.mockResolvedValue(undefined);
    messageMocks.recoverPersistedMCPResult.mockResolvedValue(undefined);
    messageMocks.beginMCPResultInvocation.mockResolvedValue(true);
    messageMocks.persistMCPResult.mockResolvedValue(true);
    messageMocks.update.mockResolvedValue(undefined);
    searchMocks.search.mockResolvedValue({
      content: '{"error":"search failed"}',
      state: { results: [] },
      success: false,
    });
  });

  it('replays a completed step without invoking the tool again', async () => {
    generationMocks.findCompletedStepByHash.mockResolvedValue({
      result: {
        content: '{"cached":true}',
        messageId: 'tool-message-cached',
        shouldContinue: true,
        success: true,
      },
    });

    const result = await executeConversationToolStep({
      assistantMessage,
      attempt: 2,
      db: {} as any,
      operationId: 'operation-1',
      payload: payload(),
      userId: 'user-1',
    });

    expect(result).toMatchObject({
      content: '{"cached":true}',
      messageId: 'tool-message-cached',
      success: true,
    });
    expect(generationMocks.claimStep).not.toHaveBeenCalled();
    expect(pluginMocks.findById).not.toHaveBeenCalled();
  });

  it('replays a succeeded step returned by claim instead of wiping and re-invoking it', async () => {
    generationMocks.claimStep.mockResolvedValue({
      result: {
        content: '{"already":true}',
        messageId: 'tool-message-existing',
        shouldContinue: true,
        success: true,
      },
      status: 'succeeded',
    });

    const result = await executeConversationToolStep({
      assistantMessage,
      attempt: 3,
      db: {} as any,
      operationId: 'operation-1',
      payload: payload(),
      userId: 'user-1',
    });

    expect(result).toMatchObject({
      content: '{"already":true}',
      messageId: 'tool-message-existing',
      success: true,
    });
    expect(pluginMocks.findById).not.toHaveBeenCalled();
    expect(generationMocks.updateStep).not.toHaveBeenCalled();
  });

  it('serializes a memory write and step completion in one transaction', async () => {
    const whereUpdate = vi.fn().mockResolvedValue(undefined);
    const trx = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => ({
              for: vi.fn(() => ({
                limit: vi.fn().mockResolvedValue([{ fixedMemory: '#1: Existing', id: 'agent-1' }]),
              })),
            })),
          })),
        })),
      })),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: whereUpdate })) })),
    };
    const db = {
      transaction: vi.fn(async (callback) => callback(trx)),
    };

    const result = await executeConversationToolStep({
      assistantMessage,
      attempt: 1,
      db: db as any,
      operationId: 'operation-1',
      payload: payload({
        apiName: MemoryApiName.saveMemory,
        arguments: JSON.stringify({ content: 'Likes concise answers' }),
        identifier: MemoryManifest.identifier,
      }),
      userId: 'user-1',
    });

    expect(result).toMatchObject({ shouldContinue: true, success: true });
    expect(trx.update).toHaveBeenCalled();
    expect(whereUpdate).toHaveBeenCalled();
    expect(generationMocks.updateStep).toHaveBeenCalledWith(
      'step-1',
      expect.objectContaining({
        result: expect.objectContaining({ messageId: 'tool-message-1', success: true }),
        status: 'succeeded',
      }),
    );
  });

  it('persists MCP failures as replayable tool results', async () => {
    pluginMocks.findById.mockResolvedValue({
      customParams: { mcp: { type: 'http', url: 'https://mcp.example.test' } },
    });
    mcpMocks.callTool.mockRejectedValue(new Error('remote tool failed'));

    const result = await executeConversationToolStep({
      assistantMessage,
      attempt: 1,
      db: {} as any,
      operationId: 'operation-1',
      payload: payload(),
      userId: 'user-1',
    });

    expect(result).toMatchObject({
      messageId: 'tool-message-1',
      shouldContinue: true,
      success: false,
    });
    expect(messageMocks.persistMCPResult).toHaveBeenCalledWith(
      'tool-message-1',
      expect.stringMatching(/^mi_/),
      expect.stringContaining('remote tool failed'),
    );
    expect(messageMocks.updatePluginError).toHaveBeenCalledWith(
      'tool-message-1',
      expect.objectContaining({ type: 'ToolExecutionError' }),
    );
    expect(generationMocks.updateStep).toHaveBeenCalledWith(
      'step-1',
      expect.objectContaining({ status: 'succeeded' }),
    );
  });

  it('treats MCP isError payloads as failed tool results', async () => {
    pluginMocks.findById.mockResolvedValue({
      customParams: { mcp: { type: 'http', url: 'https://mcp.example.test' } },
    });
    mcpMocks.callTool.mockResolvedValue({ content: 'denied', isError: true });

    const result = await executeConversationToolStep({
      assistantMessage,
      attempt: 1,
      db: {} as any,
      operationId: 'operation-1',
      payload: payload(),
      userId: 'user-1',
    });

    expect(result.success).toBe(false);
    expect(messageMocks.updatePluginError).toHaveBeenCalledWith(
      'tool-message-1',
      expect.objectContaining({ type: 'ToolExecutionError' }),
    );
  });

  it('replays a persisted MCP error as a failed result', async () => {
    pluginMocks.findById.mockResolvedValue({
      customParams: { mcp: { type: 'http', url: 'https://mcp.example.test' } },
    });
    messageMocks.findToolMessageByCall.mockResolvedValue({ id: 'tool-message-1' });
    messageMocks.recoverPersistedMCPResult.mockResolvedValue({
      content: '{"error":"remote tool failed"}',
      error: { message: 'remote tool failed', type: 'ToolExecutionError' },
    });

    const result = await executeConversationToolStep({
      assistantMessage,
      attempt: 2,
      db: {} as any,
      operationId: 'operation-1',
      payload: payload(),
      userId: 'user-1',
    });

    expect(result).toMatchObject({ success: false, shouldContinue: true });
    expect(mcpMocks.callTool).not.toHaveBeenCalled();
  });

  it('keeps browsing after a failed web search and stores the tool message id', async () => {
    const result = await executeConversationToolStep({
      assistantMessage,
      attempt: 1,
      db: {} as any,
      operationId: 'operation-1',
      payload: payload({
        apiName: WebBrowsingApiName.search,
        identifier: WebBrowsingManifest.identifier,
      }),
      userId: 'user-1',
    });

    expect(result).toMatchObject({
      messageId: 'tool-message-1',
      shouldContinue: true,
      success: false,
    });
    expect(messageMocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        content: '{"error":"search failed"}',
        tool_call_id: 'tool-call-1',
      }),
    );
  });

  it('updates an existing tool message instead of creating a duplicate', async () => {
    messageMocks.findToolMessageByCall.mockResolvedValue({ id: 'tool-message-existing' });

    const result = await executeConversationToolStep({
      assistantMessage,
      attempt: 2,
      db: {} as any,
      operationId: 'operation-1',
      payload: payload({
        apiName: WebBrowsingApiName.search,
        identifier: WebBrowsingManifest.identifier,
      }),
      userId: 'user-1',
    });

    expect(result.messageId).toBe('tool-message-existing');
    expect(messageMocks.create).not.toHaveBeenCalled();
    expect(messageMocks.update).toHaveBeenCalledWith(
      'tool-message-existing',
      expect.objectContaining({ content: '{"error":"search failed"}' }),
    );
  });

  it('reuses a stable MCP invocation id across attempts so a pending fence can be stolen', async () => {
    pluginMocks.findById.mockResolvedValue({
      customParams: { mcp: { type: 'http', url: 'https://mcp.example.test' } },
    });
    mcpMocks.callTool.mockResolvedValue({ content: 'ok' });
    messageMocks.findToolMessageByCall.mockResolvedValue({ id: 'tool-message-1' });
    messageMocks.beginMCPResultInvocation.mockResolvedValue(true);
    messageMocks.persistMCPResult.mockResolvedValue(true);

    await executeConversationToolStep({
      assistantMessage,
      attempt: 1,
      db: {} as any,
      operationId: 'operation-1',
      payload: payload(),
      userId: 'user-1',
    });
    await executeConversationToolStep({
      assistantMessage,
      attempt: 4,
      db: {} as any,
      operationId: 'operation-1',
      payload: payload(),
      userId: 'user-1',
    });

    const firstId = messageMocks.beginMCPResultInvocation.mock.calls[0][1];
    expect(firstId).toMatch(/^mi_[a-f0-9]+$/);
    expect(messageMocks.beginMCPResultInvocation.mock.calls[1][1]).toBe(firstId);
    expect(messageMocks.beginMCPResultInvocation).toHaveBeenCalledWith(
      'tool-message-1',
      firstId,
      expect.objectContaining({ stalePendingMs: 90_000 }),
    );
  });

  it('does not steal an in-progress MCP invocation', async () => {
    pluginMocks.findById.mockResolvedValue({
      customParams: { mcp: { type: 'http', url: 'https://mcp.example.test' } },
    });
    messageMocks.beginMCPResultInvocation.mockResolvedValue(false);
    messageMocks.recoverPersistedMCPResult.mockResolvedValue(undefined);

    await expect(
      executeConversationToolStep({
        assistantMessage,
        attempt: 1,
        db: {} as any,
        operationId: 'operation-1',
        payload: payload(),
        userId: 'user-1',
      }),
    ).rejects.toThrow('already in progress');
    expect(mcpMocks.callTool).not.toHaveBeenCalled();
  });
});

describe('findUnsupportedConversationTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defers image generation to the browser', async () => {
    await expect(
      findUnsupportedConversationTool({
        config: {
          model: 'model-1',
          plugins: [DalleManifest.identifier],
          provider: 'provider-1',
        },
        db: {} as any,
        userId: 'user-1',
      }),
    ).resolves.toMatchObject({ identifier: DalleManifest.identifier });
  });

  it('defers the code interpreter to the browser', async () => {
    await expect(
      findUnsupportedConversationTool({
        config: {
          model: 'model-1',
          plugins: [CodeInterpreterIdentifier],
          provider: 'provider-1',
        },
        db: {} as any,
        userId: 'user-1',
      }),
    ).resolves.toMatchObject({ identifier: CodeInterpreterIdentifier });
  });

  it('allows HTTP MCP and defers non-HTTP plugins', async () => {
    pluginMocks.findById
      .mockResolvedValueOnce({
        customParams: { mcp: { type: 'http', url: 'https://mcp.example.test' } },
      })
      .mockResolvedValueOnce({
        customParams: { mcp: { type: 'stdio' } },
      });

    await expect(
      findUnsupportedConversationTool({
        config: { model: 'model-1', plugins: ['mcp-http'], provider: 'provider-1' },
        db: {} as any,
        userId: 'user-1',
      }),
    ).resolves.toBeUndefined();
    await expect(
      findUnsupportedConversationTool({
        config: { model: 'model-1', plugins: ['mcp-stdio'], provider: 'provider-1' },
        db: {} as any,
        userId: 'user-1',
      }),
    ).resolves.toMatchObject({ identifier: 'mcp-stdio' });
  });
});
