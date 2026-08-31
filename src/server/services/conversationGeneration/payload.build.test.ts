/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as usage from '@/helpers/contextUsageEstimate';

import { buildConversationChatPayload } from './payload';

vi.mock('@/envs/llm', () => ({
  getLLMConfig: () => ({}),
}));

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

describe('buildConversationChatPayload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const runtimeState = {
    enabledAiModels: [
      {
        abilities: { functionCall: true },
        contextWindowTokens: 128_000,
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

  it('counts memory, wrapped summary, skill XML, and per-user templates in the next-request window', async () => {
    const spy = vi.spyOn(usage, 'estimateFixedContextOverheadTokens');
    const skillBody = 'Review diffs carefully.';
    const inputTemplate = 'Template: {{text}}';
    const messages = [
      { content: 'old', id: 'old', role: 'user' },
      { content: 'Hello', id: 'u1', role: 'user' },
      { content: 'Hi again', id: 'u2', role: 'user' },
    ];

    const result = await buildConversationChatPayload({
      agentMemory: { dynamicMemory: 'remember the port', fixedMemory: 'always use Bun' },
      config: {
        ...baseConfig,
        chatConfig: {
          ...baseConfig.chatConfig,
          inputTemplate,
        },
        historySummary: 'prior turns',
        historySummaryLastMessageId: 'old',
      } as any,
      db: {} as any,
      generalInstruction: 'Be concise.',
      historySummary: 'prior turns',
      messages: messages as any,
      runtimeState,
      sessionId: 'sess-1',
      userId: 'user-1',
    });

    const skillInstructions = spy.mock.calls[0]?.[0]?.skillInstructions as string;
    expect(skillInstructions).toContain('<activated_skills>');
    expect(skillInstructions).toContain('<skill name="reviewer">');
    expect(skillInstructions).toContain(skillBody);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        historySummaryRaw: 'prior turns',
        skillInstructions,
        systemRole: 'Be concise.',
      }),
    );
    expect(spy.mock.calls[0]?.[0]).not.toHaveProperty('inputTemplate');
    expect(String(spy.mock.calls[0]?.[0]?.agentMemory)).toContain('remember the port');

    const userContents = result.payload.messages
      .filter((item) => item.role === 'user')
      .map((item) => String(item.content));
    expect(userContents).toEqual(['Template: Hello', 'Template: Hi again']);
    const serialized = JSON.stringify(result.payload.messages);
    expect(serialized).toContain('<activated_skills>');
    expect(serialized).toContain(skillBody);
    expect(serialized).toContain('remember the port');
    expect(serialized).toContain('prior turns');
    expect(serialized).not.toContain('"old"');
  });

  it('keeps ChatHub search on MiMo Token Plan when native search is selected', async () => {
    const result = await buildConversationChatPayload({
      config: {
        ...baseConfig,
        chatConfig: {
          ...baseConfig.chatConfig,
          searchMode: 'on',
          useModelBuiltinSearch: true,
        },
        model: 'mimo-v2.5-pro',
        provider: 'mimo',
      } as any,
      db: {} as any,
      generalInstruction: '',
      messages: [{ content: 'What happened today?', id: 'u1', role: 'user' } as any],
      runtimeState: {
        enabledAiModels: [
          {
            abilities: { functionCall: true },
            id: 'mimo-v2.5-pro',
            providerId: 'mimo',
            settings: { searchImpl: 'params' },
          },
        ],
        runtimeConfig: {
          mimo: {
            keyVaults: { baseURL: 'https://token-plan-cn.xiaomimimo.com/v1' },
          },
        },
      } as any,
      sessionId: 'sess-1',
      userId: 'user-1',
    });

    expect(result.payload.enabledSearch).toBeUndefined();
    expect(result.enabledToolIds).toContain('lobe-web-browsing');
  });
});
