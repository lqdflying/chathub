/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as usage from '@/helpers/contextUsageEstimate';

import { buildConversationChatPayload } from './payload';

vi.mock('@/database/models/plugin', () => ({
  PluginModel: class {
    query = async () => [];
  },
}));

vi.mock('@/database/models/skill', () => ({
  SkillModel: class {
    findById = async () =>
      ({
        description: 'skill',
        identifier: 'reviewer',
        instructions: 'Review diffs carefully.',
        name: 'reviewer',
      }) as any;
  },
}));

vi.mock('@/server/services/file', () => ({
  FileService: class {
    getFullFileUrl = async (url: string) => url;
  },
}));

vi.mock('@/helpers/modelContextWindowTokens', () => ({
  getModelContextWindowTokens: () => 128_000,
}));

describe('buildConversationChatPayload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const runtimeState = {
    enabledAiModels: [
      {
        abilities: { functionCall: true },
        id: 'gpt-4o',
        providerId: 'openai',
      },
    ],
    runtimeConfig: {},
  } as any;

  const baseConfig = {
    activatedSkillIds: ['reviewer'],
    chatConfig: {
      enableAssistantMemory: true,
      enableHistoryCount: true,
      historyCount: 20,
      inputTemplate: 'Template: {{text}}',
    },
    model: 'gpt-4o',
    plugins: [],
    provider: 'openai',
    systemRole: '',
  };

  it('completes with blank instructions and does not inject an empty system row', async () => {
    const result = await buildConversationChatPayload({
      config: baseConfig as any,
      db: {} as any,
      generalInstruction: '',
      messages: [{ content: 'Hello', id: 'u1', role: 'user' } as any],
      runtimeState,
      sessionId: 'sess-1',
      userId: 'user-1',
    });

    expect(
      result.payload.messages.some((item) => item.role === 'system' && !item.content?.trim()),
    ).toBe(false);
    expect(result.payload.messages.find((item) => item.role === 'user')?.content).toContain('Hello');
  });

  it('counts memory, wrapped summary, skill instructions, and input template in fixed overhead', async () => {
    const spy = vi.spyOn(usage, 'estimateFixedContextOverheadTokens');

    const result = await buildConversationChatPayload({
      agentMemory: { dynamicMemory: 'remember the port', fixedMemory: 'always use Bun' },
      config: {
        ...baseConfig,
        historySummary: 'prior turns',
        historySummaryLastMessageId: 'old',
      } as any,
      db: {} as any,
      generalInstruction: 'Be concise.',
      historySummary: 'prior turns',
      messages: [
        { content: 'old', id: 'old', role: 'user' },
        { content: 'Hello', id: 'u1', role: 'user' },
      ] as any,
      runtimeState,
      sessionId: 'sess-1',
      userId: 'user-1',
    });

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        historySummaryRaw: 'prior turns',
        inputTemplate: 'Template: {{text}}',
        skillInstructions: 'Review diffs carefully.',
        systemRole: 'Be concise.',
      }),
    );
    expect(String(spy.mock.calls[0]?.[0]?.agentMemory)).toContain('remember the port');
    const serialized = JSON.stringify(result.payload.messages);
    expect(serialized).toContain('remember the port');
    expect(serialized).toContain('prior turns');
    expect(serialized).toContain('Review diffs carefully.');
  });
});
