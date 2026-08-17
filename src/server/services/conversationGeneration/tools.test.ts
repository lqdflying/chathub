/** @vitest-environment node */
import type { ChatToolPayload, UIChatMessage } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DalleManifest } from '@/tools/dalle';
import { MemoryApiName, MemoryManifest } from '@/tools/memory';

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
  updatePluginError: vi.fn(),
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
    updatePluginError = messageMocks.updatePluginError;
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
  WebBrowsingExecutionRuntime: class {},
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
        result: expect.objectContaining({ success: true }),
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
