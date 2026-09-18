import { beforeEach, describe, expect, it, vi } from 'vitest';

import { formatSkillInstructionsBlock } from '@lobechat/context-engine';

import { wrapHistorySummaryForTokenEstimate } from './contextUsageEstimate';
import { estimateContextUsageAsync } from './estimateContextUsageAsync';
import { clearAnchorBaselines } from './reportedContextTokens';

const mocks = vi.hoisted(() => ({
  chats: [{ content: 'chat-text', id: 'u1', role: 'user' }] as Array<{
    content: string;
    createdAt?: number;
    id: string;
    metadata?: { totalInputTokens?: number };
    role: string;
    tool_call_id?: string;
    updatedAt?: number;
  }>,
  historyCount: 20,
  inputTemplate: '',
  skillRecords: [] as Array<{
    description: string;
    identifier: string;
    instructions: string;
    name: string;
  }>,
  topic: { metadata: {} as Record<string, unknown> },
}));

vi.mock('@/utils/tokenizer', () => ({
  encodeAsync: vi.fn(async (text: string) => text.length),
}));

vi.mock('@/helpers/assistantMemory', () => ({
  normalizeAssistantMemoryText: (value: string) => value,
}));

vi.mock('@/helpers/memoryArchivePrompt', () => ({
  buildHistorySummaryForRequest: () => 'history-summary-text',
}));

vi.mock('@/helpers/modelContextWindowTokens', () => ({
  getModelContextWindowTokens: () => 8000,
}));

vi.mock('@/helpers/toolEngineering', () => ({
  createChatToolsEngine: () => ({
    generateToolsDetailed: () => ({
      enabledToolIds: ['tool-1'],
      tools: [{ function: { name: 'search' } }],
    }),
  }),
}));

vi.mock('@/services/chat/composeSystemRole', () => ({
  composeSystemRole: () => 'system-role-text',
}));

vi.mock('@/store/agent/selectors', () => ({
  agentChatConfigSelectors: {
    currentChatConfig: () => ({
      enableCompressHistory: true,
      enableUserMemoryArchive: false,
      inputTemplate: mocks.inputTemplate,
    }),
    enableAssistantMemory: () => false,
    enableHistoryCount: () => true,
    historyCount: () => mocks.historyCount,
  },
  agentSelectors: {
    currentAgentConfig: () => ({}),
    currentAgentModel: () => 'gpt-5-mini',
    currentAgentModelProvider: () => 'openai',
    currentAgentPlugins: () => [],
    currentAgentSystemRole: () => 'agent-role',
  },
}));

vi.mock('@/services/skill', () => ({
  skillService: {
    resolveSkills: async () => mocks.skillRecords,
  },
}));

vi.mock('@/store/skill', () => ({
  getSkillSelectionKey: () => 'session:topic:main',
  getSkillStoreState: () => ({}),
  skillSelectors: {
    selectedSkillIds: () => () => mocks.skillRecords.map((skill) => skill.identifier),
  },
}));

vi.mock('@/store/aiInfra', () => ({
  aiModelSelectors: {
    isModelSupportToolUse: () => () => true,
  },
  getAiInfraStoreState: () => ({}),
}));

vi.mock('@/store/chat/selectors', () => ({
  chatSelectors: {
    mainAIChats: () => mocks.chats,
  },
  topicSelectors: {
    currentActiveTopic: () => mocks.topic,
    currentActiveTopicSummary: () => ({ content: 'summary' }),
  },
}));

vi.mock('@/store/tool/selectors', () => ({
  toolSelectors: {
    enabledSystemRoles: () => () => 'plugin-system-role',
  },
}));

vi.mock('@/store/tool/store', () => ({
  getToolStoreState: () => ({}),
}));

vi.mock('@/store/user/selectors', () => ({
  userGeneralSettingsSelectors: {
    generalInstruction: () => '',
  },
}));

vi.mock('@/store/user/store', () => ({
  getUserStoreState: () => ({}),
}));

describe('estimateContextUsageAsync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAnchorBaselines();
    mocks.historyCount = 20;
    mocks.inputTemplate = '';
    mocks.skillRecords = [];
    mocks.topic = { metadata: {} };
    mocks.chats = [{ content: 'chat-text', id: 'u1', role: 'user' }];
  });

  it('returns systemRole, tools, and input token parts alongside the total', async () => {
    const result = await estimateContextUsageAsync({
      agentState: {} as any,
      chatState: { inputMessage: 'input-text' } as any,
    });

    expect(result.systemRoleToken).toBe('system-role-text'.length);
    expect(result.toolsToken).toBeGreaterThan(0);
    expect(result.inputToken).toBe('input-text'.length);
    expect(result.chatsToken).toBe('user:\nchat-text\nuser:\ninput-text'.length);
    expect(result.historySummaryToken).toBe(
      wrapHistorySummaryForTokenEstimate('history-summary-text').length,
    );
    expect(result.contextMessages.map(({ id }) => id)).toEqual(['u1']);
    expect(result.totalToken).toBe(
      result.systemRoleToken +
        result.memoryToken +
        result.historySummaryToken +
        result.toolsToken +
        result.chatsToken,
    );
  });

  it('keeps the HistoryTruncate setting separate from continuation-extended included rows', async () => {
    mocks.historyCount = 2;
    mocks.chats = [
      { content: 'u1', id: 'u1', role: 'user' },
      { content: 'a1', id: 'a1', role: 'assistant' },
      { content: 'u2', id: 'u2', role: 'user' },
      { content: 'a2', id: 'a2', role: 'assistant' },
      { content: 'u3', id: 'u3', role: 'user' },
      { content: 'a3', id: 'a3', role: 'assistant' },
      { content: 'tool3', id: 'tool3', role: 'tool', tool_call_id: 'tc3' },
    ];

    const result = await estimateContextUsageAsync({
      agentState: {} as any,
      chatState: { inputMessage: '' } as any,
    });

    expect(result.effectiveHistoryCount).toBe(2);
    expect(result.includedMessageCount).toBe(4);
    expect(result.contextMessages.map(({ id }) => id)).toEqual(['a2', 'u3', 'a3', 'tool3']);
  });

  it('includes activated skill XML and per-user template expansion in chats tokens', async () => {
    mocks.inputTemplate = 'Ask: {{text}}';
    mocks.skillRecords = [
      {
        description: 'Review code.',
        identifier: 'reviewer',
        instructions: 'Inspect every diff.',
        name: 'reviewer',
      },
    ];
    mocks.chats = [
      { content: 'one', id: 'u1', role: 'user' },
      { content: 'two', id: 'u2', role: 'user' },
    ];

    const result = await estimateContextUsageAsync({
      agentState: {} as any,
      chatState: { inputMessage: '' } as any,
    });

    expect(result.chatsToken).toBe('user:\nAsk: one\nuser:\nAsk: two'.length);
    expect(result.totalToken).toBeGreaterThan(
      result.systemRoleToken +
        result.memoryToken +
        result.historySummaryToken +
        result.toolsToken +
        result.chatsToken +
        result.inputToken,
    );
  });

  it('templates pending input once and keeps it out of persisted contextMessages', async () => {
    mocks.inputTemplate = '{{text}}{{text}}';
    mocks.chats = [{ content: 'one', id: 'u1', role: 'user' }];

    const result = await estimateContextUsageAsync({
      agentState: {} as any,
      chatState: { inputMessage: 'draft' } as any,
    });

    expect(result.inputToken).toBe('draftdraft'.length);
    expect(result.chatsToken).toBe('user:\noneone\nuser:\ndraftdraft'.length);
    expect(result.contextMessages.map(({ id }) => id)).toEqual(['u1']);
    expect(result.totalToken).toBe(
      result.systemRoleToken +
        result.memoryToken +
        result.historySummaryToken +
        result.toolsToken +
        result.chatsToken,
    );
  });

  it('anchors the estimate on the latest provider-reported input tokens plus the tail', async () => {
    mocks.chats = [
      { content: 'hi', id: 'u1', role: 'user' },
      {
        content: 'ok',
        id: 'a1',
        metadata: { totalInputTokens: 50_000 },
        role: 'assistant',
      } as (typeof mocks.chats)[number],
    ];

    const result = await estimateContextUsageAsync({
      agentState: {} as any,
      chatState: { inputMessage: '' } as any,
    });

    // 50_000 reported + tail 'assistant:\nok' (13) — the anchor's own reply was
    // output of that request, so it is tokenized as part of the tail.
    expect(result.totalToken).toBe(50_013);
    expect(result.chatsToken).toBeGreaterThan(0);
  });

  it('anchors mid-window and does not tokenize messages covered by the report', async () => {
    mocks.chats = [
      { content: 'x'.repeat(5000), id: 'u1', role: 'user' },
      {
        content: 'y'.repeat(100),
        id: 'a1',
        metadata: { totalInputTokens: 5000 },
        role: 'assistant',
      } as (typeof mocks.chats)[number],
      { content: 'next', id: 'u2', role: 'user' },
      { content: 'fresh', id: 'a2', role: 'assistant' },
    ];

    const result = await estimateContextUsageAsync({
      agentState: {} as any,
      chatState: { inputMessage: '' } as any,
    });

    // tail = a1 (111) + u2 ('user:\nnext' 10) + a2 ('assistant:\nfresh' 16) + 2 joins = 139
    expect(result.totalToken).toBe(5000 + 139);
    // The whole-window estimate would include u1's 5000 chars on top.
    expect(result.totalToken).toBeLessThan(5000 + 5000);
  });

  it('adds the fixed-overhead delta when skills change after the anchor request', async () => {
    mocks.chats = [
      { content: 'hi', id: 'u1', role: 'user' },
      {
        content: 'ok',
        id: 'a1',
        metadata: { totalInputTokens: 50_000 },
        role: 'assistant',
      } as (typeof mocks.chats)[number],
    ];

    // First sight registers the anchor baseline (delta 0).
    const first = await estimateContextUsageAsync({
      agentState: {} as any,
      chatState: { inputMessage: '' } as any,
    });
    expect(first.totalToken).toBe(50_013);

    // Activating a skill grows the fixed overhead AFTER the anchor's request;
    // the anchored total must move up by exactly the new skill block.
    const skill = {
      description: 'd',
      identifier: 'skill-1',
      instructions: 'x'.repeat(200),
      name: 's',
    };
    mocks.skillRecords = [skill];
    const skillBlock = formatSkillInstructionsBlock({ activated: [skill] });

    const second = await estimateContextUsageAsync({
      agentState: {} as any,
      chatState: { inputMessage: '' } as any,
    });
    expect(second.totalToken).toBe(50_013 + skillBlock.length);
  });

  it('falls back to the whole window once when the pre-anchor prefix changed', async () => {
    mocks.chats = [
      { content: 'hi', id: 'u1', role: 'user' },
      {
        content: 'ok',
        id: 'a1',
        metadata: { totalInputTokens: 50_000 },
        role: 'assistant',
      } as (typeof mocks.chats)[number],
    ];

    const first = await estimateContextUsageAsync({
      agentState: {} as any,
      chatState: { inputMessage: '' } as any,
    });
    expect(first.totalToken).toBe(50_013);

    // Editing a pre-anchor message invalidates what the reported input covered.
    mocks.chats = [
      { content: 'x'.repeat(60_000), id: 'u1', role: 'user', updatedAt: 2 },
      {
        content: 'ok',
        id: 'a1',
        metadata: { totalInputTokens: 50_000 },
        role: 'assistant',
      } as (typeof mocks.chats)[number],
    ];

    const second = await estimateContextUsageAsync({
      agentState: {} as any,
      chatState: { inputMessage: '' } as any,
    });
    // Whole-window fallback: the edited 60k prefix is tokenized again, so the
    // total far exceeds anchor + tail.
    expect(second.totalToken).toBeGreaterThan(60_000);

    // The mismatch re-registered the baseline, so the next estimate anchors again.
    const third = await estimateContextUsageAsync({
      agentState: {} as any,
      chatState: { inputMessage: '' } as any,
    });
    expect(third.totalToken).toBe(50_013);
  });

  it('does not anchor on the protected assistant after an identity watermark, even if updatedAt is newer', async () => {
    mocks.chats = [
      { content: 'old', id: 'u1', role: 'user' },
      {
        content: 'old-a',
        id: 'a1',
        metadata: { totalInputTokens: 1_048_570 },
        role: 'assistant',
        updatedAt: 1000,
      },
      { content: 'hi', id: 'u2', role: 'user' },
      {
        content: 'ok',
        id: 'a2',
        metadata: { totalInputTokens: 1_048_570 },
        role: 'assistant',
        updatedAt: 9000,
      },
    ];
    mocks.topic = {
      metadata: {
        historySummaryLastMessageId: 'a1',
        reportedInputTokenFloorAfterMessageId: 'a2',
      },
    };

    const result = await estimateContextUsageAsync({
      agentState: {} as any,
      chatState: { inputMessage: '' } as any,
    });

    expect(result.totalToken).toBeLessThan(1_048_570);
    expect(result.contextMessages.map(({ id }) => id)).toEqual(['u2', 'a2']);
  });

  it('anchors a later assistant even when that row has older timestamps than the protected turn', async () => {
    mocks.chats = [
      { content: 'old', id: 'u1', role: 'user' },
      {
        content: 'old-a',
        id: 'a1',
        metadata: { totalInputTokens: 1_048_570 },
        role: 'assistant',
        updatedAt: 1000,
      },
      { content: 'hi', id: 'u2', role: 'user' },
      {
        content: 'protected',
        id: 'a2',
        metadata: { totalInputTokens: 1_048_570 },
        role: 'assistant',
        updatedAt: 9000,
      },
      { content: 'next', id: 'u3', role: 'user' },
      {
        content: 'fresh',
        id: 'a3',
        metadata: { totalInputTokens: 400 },
        role: 'assistant',
        updatedAt: 50,
      },
    ];
    mocks.topic = {
      metadata: {
        historySummaryLastMessageId: 'a1',
        reportedInputTokenFloorAfterMessageId: 'a2',
      },
    };

    const result = await estimateContextUsageAsync({
      agentState: {} as any,
      chatState: { inputMessage: '' } as any,
    });

    // Anchor a3 (400) + tail 'assistant:\nfresh' (16) — u3 is inside the reported input.
    expect(result.totalToken).toBe(416);
  });

  it('does not anchor on a protected assistant when a cursor exists without a watermark', async () => {
    mocks.chats = [
      { content: 'old', id: 'u1', role: 'user' },
      {
        content: 'old-a',
        id: 'a1',
        metadata: { totalInputTokens: 1_048_570 },
        role: 'assistant',
      },
      { content: 'hi', id: 'u2', role: 'user' },
      {
        content: 'protected',
        id: 'a2',
        metadata: { totalInputTokens: 1_048_570 },
        role: 'assistant',
      },
    ];
    mocks.topic = {
      metadata: {
        historySummaryLastMessageId: 'a1',
      },
    };

    const result = await estimateContextUsageAsync({
      agentState: {} as any,
      chatState: { inputMessage: '' } as any,
    });

    expect(result.totalToken).toBeLessThan(1_048_570);
    expect(result.contextMessages.map(({ id }) => id)).toEqual(['u2', 'a2']);
  });

  it('does not revive older usage after the watermark row is deleted', async () => {
    mocks.chats = [
      { content: 'old', id: 'u1', role: 'user' },
      {
        content: 'old-a',
        id: 'a1',
        metadata: { totalInputTokens: 1_048_570 },
        role: 'assistant',
      },
      { content: 'hi', id: 'u2', role: 'user' },
      {
        content: 'older-protected',
        id: 'a2',
        metadata: { totalInputTokens: 1_048_570 },
        role: 'assistant',
      },
      { content: 'later', id: 'u3', role: 'user' },
    ];
    mocks.topic = {
      metadata: {
        historySummaryLastMessageId: 'a1',
        reportedInputTokenFloorAfterMessageId: 'deleted-a3',
      },
    };

    const result = await estimateContextUsageAsync({
      agentState: {} as any,
      chatState: { inputMessage: '' } as any,
    });

    expect(result.totalToken).toBeLessThan(1_048_570);
  });

  it('does not anchor on a request that straddled compaction after the placeholder finalizes', async () => {
    mocks.chats = [
      { content: 'old', id: 'u1', role: 'user' },
      {
        content: 'old-a',
        id: 'a1',
        metadata: { totalInputTokens: 800 },
        role: 'assistant',
      },
      { content: 'hi', id: 'u2', role: 'user' },
      {
        content: 'protected',
        id: 'a2',
        metadata: { totalInputTokens: 1_048_570 },
        role: 'assistant',
      },
      {
        content: 'final',
        id: 'a3',
        metadata: { totalInputTokens: 1_048_570 },
        role: 'assistant',
      },
    ];
    mocks.topic = {
      metadata: {
        historySummaryLastMessageId: 'a1',
        reportedInputTokenFloorAfterMessageId: 'a3',
      },
    };

    const result = await estimateContextUsageAsync({
      agentState: {} as any,
      chatState: { inputMessage: '' } as any,
    });

    expect(result.totalToken).toBeLessThan(1_048_570);
  });

  it('anchors a later assistant after a persisted migration boundary', async () => {
    mocks.chats = [
      { content: 'old', id: 'u1', role: 'user' },
      {
        content: 'old-a',
        id: 'a1',
        metadata: { totalInputTokens: 1_048_570 },
        role: 'assistant',
      },
      { content: 'hi', id: 'u2', role: 'user' },
      {
        content: 'protected',
        id: 'a2',
        metadata: { totalInputTokens: 1_048_570 },
        role: 'assistant',
      },
      { content: 'next', id: 'u3', role: 'user' },
      {
        content: 'fresh',
        id: 'a3',
        metadata: { totalInputTokens: 700_000 },
        role: 'assistant',
      },
    ];
    mocks.topic = {
      metadata: {
        historySummaryLastMessageId: 'a1',
        reportedInputTokenFloorAfterMessageId: 'a2',
      },
    };

    const result = await estimateContextUsageAsync({
      agentState: {} as any,
      chatState: { inputMessage: '' } as any,
    });

    // Anchor a3 (700_000) + tail 'assistant:\nfresh' (16).
    expect(result.totalToken).toBe(700_016);
  });

  it('anchors a selected assistant when historyCount drops the stored marker', async () => {
    mocks.historyCount = 1;
    mocks.chats = [
      { content: 'old', id: 'u1', role: 'user' },
      {
        content: 'old-a',
        id: 'a1',
        metadata: { totalInputTokens: 1_048_570 },
        role: 'assistant',
      },
      { content: 'hi', id: 'u2', role: 'user' },
      {
        content: 'protected',
        id: 'a2',
        metadata: { totalInputTokens: 1_048_570 },
        role: 'assistant',
      },
      { content: 'next', id: 'u3', role: 'user' },
      {
        content: 'fresh',
        id: 'a3',
        metadata: { totalInputTokens: 700_000 },
        role: 'assistant',
      },
    ];
    mocks.topic = {
      metadata: {
        historySummaryLastMessageId: 'a1',
        reportedInputTokenFloorAfterMessageId: 'a2',
      },
    };

    const result = await estimateContextUsageAsync({
      agentState: {} as any,
      chatState: { inputMessage: '' } as any,
    });

    expect(result.contextMessages.map(({ id }) => id)).toEqual(['u3', 'a3']);
    // Anchor a3 (700_000) + tail 'assistant:\nfresh' (16).
    expect(result.totalToken).toBe(700_016);
  });

  it('anchors a new assistant after the deleted marker is rotated', async () => {
    mocks.chats = [
      { content: 'old', id: 'u1', role: 'user' },
      {
        content: 'old-a',
        id: 'a1',
        metadata: { totalInputTokens: 1_048_570 },
        role: 'assistant',
      },
      { content: 'hi', id: 'u2', role: 'user' },
      {
        content: 'older-protected',
        id: 'a2',
        metadata: { totalInputTokens: 1_048_570 },
        role: 'assistant',
      },
      { content: 'later', id: 'u3', role: 'user' },
      {
        content: 'fresh',
        id: 'a4',
        metadata: { totalInputTokens: 700_000 },
        role: 'assistant',
      },
    ];
    mocks.topic = {
      metadata: {
        historySummaryLastMessageId: 'a1',
        reportedInputTokenFloorAfterMessageId: 'a2',
      },
    };

    const result = await estimateContextUsageAsync({
      agentState: {} as any,
      chatState: { inputMessage: '' } as any,
    });

    // Anchor a4 (700_000) + tail 'assistant:\nfresh' (16).
    expect(result.totalToken).toBe(700_016);
  });

  it('anchors a post-compaction assistant after a user-only remaining window', async () => {
    mocks.chats = [
      { content: 'old', id: 'u1', role: 'user' },
      {
        content: 'old-a',
        id: 'a1',
        metadata: { totalInputTokens: 800 },
        role: 'assistant',
      },
      { content: 'hi', id: 'u3', role: 'user' },
      {
        content: 'fresh',
        id: 'a3',
        metadata: { totalInputTokens: 700_000 },
        role: 'assistant',
      },
    ];
    mocks.topic = {
      metadata: {
        historySummaryLastMessageId: 'a1',
        reportedInputTokenFloorAfterMessageId: 'u3',
      },
    };

    const result = await estimateContextUsageAsync({
      agentState: {} as any,
      chatState: { inputMessage: '' } as any,
    });

    // Anchor a3 (700_000) + tail 'assistant:\nfresh' (16).
    expect(result.totalToken).toBe(700_016);
  });

  it('anchors a fresh assistant after the sole post-cursor watermark is replaced by the cursor', async () => {
    mocks.chats = [
      { content: 'old', id: 'u1', role: 'user' },
      {
        content: 'old-a',
        id: 'a1',
        metadata: { totalInputTokens: 800 },
        role: 'assistant',
      },
      { content: 'next', id: 'u4', role: 'user' },
      {
        content: 'fresh',
        id: 'a4',
        metadata: { totalInputTokens: 700_000 },
        role: 'assistant',
      },
    ];
    mocks.topic = {
      metadata: {
        historySummaryLastMessageId: 'a1',
        reportedInputTokenFloorAfterMessageId: 'a1',
      },
    };

    const result = await estimateContextUsageAsync({
      agentState: {} as any,
      chatState: { inputMessage: '' } as any,
    });

    // Anchor a4 (700_000) + tail 'assistant:\nfresh' (16).
    expect(result.totalToken).toBe(700_016);
  });
});
