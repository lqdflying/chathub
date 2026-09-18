import { beforeEach, describe, expect, it, vi } from 'vitest';

import { formatSkillInstructionsBlock } from '@lobechat/context-engine';

import { LOADING_FLAT } from '@/const/message';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';

import { selectMessagesForContext } from './contextCompaction';
import { estimateFixedContextOverheadTokens, wrapHistorySummaryForTokenEstimate } from './contextUsageEstimate';
import { computeFixedContextOverheadInput, estimateContextUsageAsync } from './estimateContextUsageAsync';
import {
  clearAnchorBaselines,
  fingerprintAnchorPrefix,
  recordAnchorRequestWitness,
  resolveSelectedPreAnchorIds,
} from './reportedContextTokens';

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
  enableHistoryCount: true,
  historyCount: 20,
  inputTemplate: '',
  maxTokens: 8000,
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
  getModelContextWindowTokens: () => mocks.maxTokens,
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
    enableHistoryCount: () => mocks.enableHistoryCount,
    historyCount: () => mocks.historyCount,
  },
  agentSelectors: {
    currentAgentConfig: () => ({ chatConfig: { enableAssistantMemory: false } }),
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
    getTopicInContainer: () => () => mocks.topic,
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
    mocks.enableHistoryCount = true;
    mocks.historyCount = 20;
    mocks.maxTokens = 8000;
    mocks.inputTemplate = '';
    mocks.skillRecords = [];
    mocks.topic = { metadata: {} };
    mocks.chats = [{ content: 'chat-text', id: 'u1', role: 'user' }];
  });

  const estimate = (topicId: string | undefined = 'topic-1') =>
    estimateContextUsageAsync({
      agentState: {} as any,
      chatState: { activeId: 'session-1', activeTopicId: topicId, inputMessage: '' } as any,
    });

  /**
   * D2/T1 (round 5): a provider report is only trusted when the SEND PATH
   * recorded a dispatch-time witness for that exact request — estimators
   * never record witnesses. Simulate dispatch for the LAST row (an
   * assistant): record the witness with the current overhead and the full
   * prefix through its parent, exactly as the send path does, then settle the
   * row and land the report so the next estimate can promote the witness to
   * a baseline.
   */
  const dispatchWitness = async (
    assistantId: string,
    parentId: string | undefined,
    topicId: string | undefined = 'topic-1',
  ) => {
    const overhead = await computeFixedContextOverheadInput({
      agentConfig: { chatConfig: { enableAssistantMemory: false } } as any,
      chatState: { activeId: 'session-1', activeTopicId: topicId } as any,
      enableHistoryCount: true,
      isGroupSession: false,
      sessionId: 'session-1',
      topicId,
    });
    const parentIndex = parentId ? mocks.chats.findIndex(({ id }) => id === parentId) : -1;
    const prefix = parentIndex >= 0 ? mocks.chats.slice(0, parentIndex + 1) : [];
    const selected = selectMessagesForContext({
      cursorId: mocks.topic.metadata.historySummaryLastMessageId as string | undefined,
      enableHistoryCount: mocks.enableHistoryCount,
      fixedOverheadTokens: overhead.fixedOverheadTokens,
      historyCount: mocks.historyCount,
      inputTemplate: mocks.inputTemplate,
      maxTokens: mocks.maxTokens,
      messages: mocks.chats as any,
    });
    recordAnchorRequestWitness({
      assistantMessageId: assistantId,
      conversationKey: messageMapKey('session-1', topicId),
      fixedOverheadTokens: overhead.fixedOverheadTokens,
      inputTemplate: mocks.inputTemplate,
      messages: mocks.chats,
      parentMessageId: parentId,
      selectedPrefixIds: resolveSelectedPreAnchorIds({
        prefixMessages: prefix,
        selectedMessages: selected,
      }),
    });
  };

  const landReport = async (totalInputTokens: number) => {
    const last = mocks.chats.at(-1) as any;
    const metadata = last.metadata;
    delete last.metadata;
    await dispatchWitness(last.id, mocks.chats[mocks.chats.length - 2]?.id);
    last.metadata = { ...metadata, totalInputTokens };
  };

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
      { content: 'ok', id: 'a1', role: 'assistant' },
    ];
    // D2: the report lands after the in-flight estimate observed the prefix.
    await landReport(50_000);

    const result = await estimate();

    // 50_000 reported + tail 'assistant:\nok' (13) — the anchor's own reply was
    // output of that request, so it is tokenized as part of the tail.
    expect(result.totalToken).toBe(50_013);
    expect(result.chatsToken).toBeGreaterThan(0);
  });

  it('anchors mid-window and does not tokenize messages covered by the report', async () => {
    mocks.chats = [
      { content: 'x'.repeat(5000), id: 'u1', role: 'user' },
      { content: 'y'.repeat(100), id: 'a1', role: 'assistant' },
    ];
    // D2: land a1's report while it is the newest row, then the conversation grows.
    await landReport(5000);
    mocks.chats = [
      ...mocks.chats,
      { content: 'next', id: 'u2', role: 'user' },
      { content: 'fresh', id: 'a2', role: 'assistant' },
    ];

    const result = await estimate();

    // tail = a1 (111) + u2 ('user:\nnext' 10) + a2 ('assistant:\nfresh' 16) + 2 joins = 139
    expect(result.totalToken).toBe(5000 + 139);
    // The whole-window estimate would include u1's 5000 chars on top.
    expect(result.totalToken).toBeLessThan(5000 + 5000);
  });

  it('adds the fixed-overhead delta when skills change after the anchor request', async () => {
    mocks.chats = [
      { content: 'hi', id: 'u1', role: 'user' },
      { content: 'ok', id: 'a1', role: 'assistant' },
    ];

    // D2: the report lands after the dispatch witness was recorded, promoting
    // it to the anchor baseline (delta 0).
    await landReport(50_000);
    const first = await estimate();
    expect(first.totalToken).toBe(50_013);

    // Activating a skill grows the fixed overhead AFTER the anchor's request;
    // the anchored total must move up by exactly the new skill block, measured
    // in the shared chars-per-token overhead units (R4: the baseline registry
    // is shared with the token popover hook, which uses the same helper).
    const skill = {
      description: 'd',
      identifier: 'skill-1',
      instructions: 'x'.repeat(200),
      name: 's',
    };
    mocks.skillRecords = [skill];
    const skillBlock = formatSkillInstructionsBlock({ activated: [skill] });
    const overheadBefore = estimateFixedContextOverheadTokens({
      historySummaryRaw: 'history-summary-text',
      systemRole: 'system-role-text',
      toolsString: 'plugin-system-role' + JSON.stringify({ function: { name: 'search' } }),
    });
    const overheadAfter = estimateFixedContextOverheadTokens({
      historySummaryRaw: 'history-summary-text',
      skillInstructions: skillBlock,
      systemRole: 'system-role-text',
      toolsString: 'plugin-system-role' + JSON.stringify({ function: { name: 'search' } }),
    });

    const second = await estimate();
    expect(overheadAfter).toBeGreaterThan(overheadBefore);
    expect(second.totalToken).toBe(50_013 + (overheadAfter - overheadBefore));
  });

  it('shares the baseline registry with the UI hook without unit drift', async () => {
    mocks.chats = [
      { content: 'hi', id: 'u1', role: 'user' },
      {
        content: 'ok',
        id: 'a1',
        metadata: { totalInputTokens: 50_000 },
        role: 'assistant',
      } as (typeof mocks.chats)[number],
    ];

    // R4/D2: prime the shared witness exactly as the send path does at
    // dispatch — same prefix (through parent u1), overhead measured with the
    // shared chars/2 helper. The estimator must promote that witness and
    // compute the same anchored total; passing its tokenized fixedTokens
    // instead would register as phantom context (or negative drift in the
    // opposite order).
    const uiOverhead = estimateFixedContextOverheadTokens({
      historySummaryRaw: 'history-summary-text',
      systemRole: 'system-role-text',
      toolsString: 'plugin-system-role' + JSON.stringify({ function: { name: 'search' } }),
    });
    recordAnchorRequestWitness({
      assistantMessageId: 'a1',
      conversationKey: messageMapKey('session-1', 'topic-1'),
      fixedOverheadTokens: uiOverhead,
      messages: mocks.chats,
      parentMessageId: 'u1',
    });

    expect((await estimate()).totalToken).toBe(50_013);
    // The promoted baseline keeps later estimates anchored and stable.
    expect((await estimate()).totalToken).toBe(50_013);
  });

  it('keeps the anchor invalid after a prefix change until a fresh provider report', async () => {
    mocks.chats = [
      { content: 'hi', id: 'u1', role: 'user' },
      { content: 'ok', id: 'a1', role: 'assistant' },
    ];

    // D2: land the report after the in-flight estimate observed the prefix.
    await landReport(50_000);
    const first = await estimate();
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

    const second = await estimate();
    // Whole-window fallback: the edited 60k prefix is tokenized again, so the
    // total far exceeds anchor + tail.
    expect(second.totalToken).toBeGreaterThan(60_000);

    // R3: the mismatch must NOT re-register the baseline — the old report never
    // counted the edited prefix, so the anchor stays invalid (fallback) until a
    // fresh provider report arrives under a new anchor id.
    const third = await estimate();
    expect(third.totalToken).toBe(second.totalToken);

    // A fresh provider report under a new anchor re-enables anchoring — again
    // only after this process observed the new request prefix in flight (D2).
    mocks.chats = [
      ...mocks.chats,
      { content: 'next', id: 'u2', role: 'user' },
      { content: 'ok2', id: 'a2', role: 'assistant' },
    ];
    await landReport(70_000);
    const fourth = await estimate();
    // Anchored on a2: reported 70_000 + tail ('assistant:\nok2\n' = 14 chars).
    expect(fourth.totalToken).toBe(70_014);
  });

  it('D2: an unverified report falls back to a fresh full estimate (reload)', async () => {
    // A report whose request this process never observed (reload / new tab /
    // evicted baseline) must NOT be anchored: first sight is not evidence the
    // report measured the current prefix.
    mocks.chats = [
      { content: 'hi', id: 'reload-u1', role: 'user' },
      {
        content: 'ok',
        id: 'reload-a1',
        metadata: { totalInputTokens: 1000 },
        role: 'assistant',
      } as (typeof mocks.chats)[number],
    ];

    const firstSight = await estimate();
    // Whole-window fallback floored by the report — NOT anchor + tail (1013).
    expect(firstSight.totalToken).toBe(1000);

    mocks.skillRecords = [
      { description: 'd', identifier: 'large-skill', instructions: 'x'.repeat(20_000), name: 'Skill' },
    ];
    const beforeReload = await estimate();
    expect(beforeReload.totalToken).toBeGreaterThan(10_000);

    clearAnchorBaselines(); // A page reload/another browser tab has an empty module cache.
    const afterReload = await estimate();
    expect(afterReload.totalToken).toBeGreaterThanOrEqual(10_000);
    expect(afterReload.totalToken).toBeGreaterThanOrEqual(beforeReload.totalToken);
  });

  it('T1: keeps the sent request baseline when a skill changes while its reply is pending', async () => {
    mocks.chats = [
      { content: 'hi', id: 'inflight-u1', role: 'user' },
      { content: LOADING_FLAT, id: 'inflight-a1', role: 'assistant' },
    ];
    // The send path records the witness at dispatch — before any skill change.
    await dispatchWitness('inflight-a1', 'inflight-u1');

    // Selecting a 20k-char skill mid-generation must NOT be certified as
    // covered by the pending request's report: estimators never touch
    // witnesses, so the pending estimate keeps the whole-window total.
    mocks.skillRecords = [
      { description: 'd', identifier: 'large-skill', instructions: 'x'.repeat(20_000), name: 'Skill' },
    ];
    const whilePending = await estimate();
    expect(whilePending.totalToken).toBeGreaterThan(10_000);

    mocks.chats = [
      mocks.chats[0],
      { content: 'ok', id: 'inflight-a1', metadata: { totalInputTokens: 1000 }, role: 'assistant' },
    ];
    const afterReport = await estimate();
    // Anchored on the dispatch witness: 1000 report + skill-overhead delta +
    // tail — never the 1,013 undercount from certifying the new skill.
    expect(afterReport.totalToken).toBeGreaterThanOrEqual(10_000);
  });

  it('T1: does not certify a prefix edited while the original reply is pending', async () => {
    mocks.chats = [
      { content: 'hi', id: 'edit-u1', role: 'user', updatedAt: 1 },
      { content: LOADING_FLAT, id: 'edit-a1', role: 'assistant' },
    ];
    await dispatchWitness('edit-a1', 'edit-u1');

    mocks.chats[0] = { content: 'x'.repeat(60_000), id: 'edit-u1', role: 'user', updatedAt: 2 };
    const whilePending = await estimate();
    expect(whilePending.totalToken).toBeGreaterThan(60_000);

    mocks.chats = [
      mocks.chats[0],
      { content: 'ok', id: 'edit-a1', metadata: { totalInputTokens: 1000 }, role: 'assistant' },
    ];
    const afterReport = await estimate();
    // The dispatch fingerprint no longer matches — whole-window fallback.
    expect(afterReport.totalToken).toBeGreaterThanOrEqual(60_000);
  });

  it('T1: reload into an already-running request falls back to the whole window', async () => {
    // No dispatch witness exists in this process (reload / other tab): the
    // arriving report can never be promoted.
    mocks.chats = [
      { content: 'hi', id: 'reloaded-u1', role: 'user' },
      { content: LOADING_FLAT, id: 'reloaded-a1', role: 'assistant' },
    ];
    mocks.skillRecords = [
      { description: 'd', identifier: 'large-skill', instructions: 'x'.repeat(20_000), name: 'Skill' },
    ];
    const whilePending = await estimate();
    expect(whilePending.totalToken).toBeGreaterThan(10_000);

    mocks.chats = [
      mocks.chats[0],
      { content: 'ok', id: 'reloaded-a1', metadata: { totalInputTokens: 1000 }, role: 'assistant' },
    ];
    const afterReport = await estimate();
    expect(afterReport.totalToken).toBeGreaterThanOrEqual(10_000);
  });

  it('T1: estimates of another topic never certify a running request (cross-topic)', async () => {
    // Topic A is settled and estimated first…
    mocks.chats = [{ content: 'settled', id: 'a-u1', role: 'user' }];
    await estimate('topic-1');

    // …then the user opens already-running topic B, whose 20k-char skill was
    // NOT part of B's dispatched request (selected in another tab). No
    // witness for B's row exists in this process.
    mocks.skillRecords = [
      { description: 'd', identifier: 'large-skill', instructions: 'x'.repeat(20_000), name: 'Skill' },
    ];
    mocks.chats = [
      { content: 'hi', id: 'b-u1', role: 'user' },
      { content: LOADING_FLAT, id: 'b-a1', role: 'assistant' },
    ];
    const whilePending = await estimate('topic-2');
    expect(whilePending.totalToken).toBeGreaterThan(10_000);

    mocks.chats = [
      mocks.chats[0],
      { content: 'ok', id: 'b-a1', metadata: { totalInputTokens: 1000 }, role: 'assistant' },
    ];
    const afterReport = await estimate('topic-2');
    // Whole-window fallback — never the 1,013 undercount.
    expect(afterReport.totalToken).toBeGreaterThanOrEqual(10_000);
  });

  it('T1: navigating away and back keeps the original dispatch witness', async () => {
    // Topic B's request is dispatched (witness recorded without the skill)…
    mocks.chats = [
      { content: 'hi', id: 'nav-u1', role: 'user' },
      { content: LOADING_FLAT, id: 'nav-a1', role: 'assistant' },
    ];
    await dispatchWitness('nav-a1', 'nav-u1', 'topic-2');

    // …the user views settled topic A (estimates run there)…
    mocks.chats = [{ content: 'settled', id: 'a-u1', role: 'user' }];
    await estimate('topic-1');

    // …selects a 20k-char skill, and returns to still-running topic B.
    mocks.skillRecords = [
      { description: 'd', identifier: 'large-skill', instructions: 'x'.repeat(20_000), name: 'Skill' },
    ];
    mocks.chats = [
      { content: 'hi', id: 'nav-u1', role: 'user' },
      { content: LOADING_FLAT, id: 'nav-a1', role: 'assistant' },
    ];
    const whilePending = await estimate('topic-2');
    expect(whilePending.totalToken).toBeGreaterThan(10_000);

    mocks.chats = [
      mocks.chats[0],
      { content: 'ok', id: 'nav-a1', metadata: { totalInputTokens: 1000 }, role: 'assistant' },
    ];
    const afterReport = await estimate('topic-2');
    // The ORIGINAL dispatch witness promotes: report + skill delta + tail.
    expect(afterReport.totalToken).toBeGreaterThanOrEqual(10_000);
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

    // D2: land a3's report after the in-flight estimate observed the prefix.
    await landReport(400);
    const result = await estimate();

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
        role: 'assistant',
      },
    ];
    mocks.topic = {
      metadata: {
        historySummaryLastMessageId: 'a1',
        reportedInputTokenFloorAfterMessageId: 'a2',
      },
    };

    // D2: land a3's report after the in-flight estimate observed the prefix.
    await landReport(700_000);
    const result = await estimate();

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
        role: 'assistant',
      },
    ];
    mocks.topic = {
      metadata: {
        historySummaryLastMessageId: 'a1',
        reportedInputTokenFloorAfterMessageId: 'a2',
      },
    };

    // D2: land a3's report after the in-flight estimate observed the prefix.
    await landReport(700_000);
    const result = await estimate();

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
        role: 'assistant',
      },
    ];
    mocks.topic = {
      metadata: {
        historySummaryLastMessageId: 'a1',
        reportedInputTokenFloorAfterMessageId: 'a2',
      },
    };

    // D2: land a4's report after the in-flight estimate observed the prefix.
    await landReport(700_000);
    const result = await estimate();

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
        role: 'assistant',
      },
    ];
    mocks.topic = {
      metadata: {
        historySummaryLastMessageId: 'a1',
        reportedInputTokenFloorAfterMessageId: 'u3',
      },
    };

    // D2: land a3's report after the in-flight estimate observed the prefix.
    await landReport(700_000);
    const result = await estimate();

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
        role: 'assistant',
      },
    ];
    mocks.topic = {
      metadata: {
        historySummaryLastMessageId: 'a1',
        reportedInputTokenFloorAfterMessageId: 'a1',
      },
    };

    // D2: land a4's report after the in-flight estimate observed the prefix.
    await landReport(700_000);
    const result = await estimate();

    // Anchor a4 (700_000) + tail 'assistant:\nfresh' (16).
    expect(result.totalToken).toBe(700_016);
  });

  it('U2: widening history counts newly included pre-anchor messages', async () => {
    mocks.historyCount = 2;
    mocks.chats = [
      { content: 'x'.repeat(20_000), id: 'old-u', role: 'user' },
      { content: 'old answer', id: 'old-a', role: 'assistant' },
      { content: 'hi', id: 'new-u', role: 'user' },
      { content: 'ok', id: 'new-a', role: 'assistant' },
    ];
    await landReport(1000);
    const short = await estimate();
    expect(short.contextMessages.some((message) => message.id === 'old-u')).toBe(false);
    expect(short.totalToken).toBe(1013);

    mocks.historyCount = 20;
    const expanded = await estimate();
    expect(expanded.contextMessages.some((message) => message.id === 'old-u')).toBe(true);
    expect(expanded.totalToken).toBeGreaterThan(20_000);
  });

  it('U2: disabling the history limit counts newly included pre-anchor messages', async () => {
    mocks.historyCount = 2;
    mocks.chats = [
      { content: 'x'.repeat(20_000), id: 'old-u', role: 'user' },
      { content: 'old answer', id: 'old-a', role: 'assistant' },
      { content: 'hi', id: 'new-u', role: 'user' },
      { content: 'ok', id: 'new-a', role: 'assistant' },
    ];
    await landReport(1000);
    expect((await estimate()).totalToken).toBe(1013);

    mocks.enableHistoryCount = false;
    const unlimited = await estimate();
    expect(unlimited.contextMessages.some((message) => message.id === 'old-u')).toBe(true);
    expect(unlimited.totalToken).toBeGreaterThan(20_000);
  });

  it('U2: an effective-window expansion invalidates the short-window report', async () => {
    mocks.historyCount = 2;
    mocks.chats = [
      { content: 'x'.repeat(20_000), id: 'old-u', role: 'user' },
      { content: 'old answer', id: 'old-a', role: 'assistant' },
      { content: 'hi', id: 'new-u', role: 'user' },
      { content: 'ok', id: 'new-a', role: 'assistant' },
    ];
    await landReport(1000);
    expect((await estimate()).contextMessages.some((message) => message.id === 'old-u')).toBe(
      false,
    );

    mocks.maxTokens = 200_000;
    const expanded = await estimate();
    expect(expanded.contextMessages.some((message) => message.id === 'old-u')).toBe(true);
    expect(expanded.totalToken).toBeGreaterThan(20_000);
  });

  it('U3: changing the input template recounts pre-anchor user rows', async () => {
    mocks.chats = [
      { content: 'hi', id: 'u1', role: 'user' },
      { content: 'ok', id: 'a1', role: 'assistant' },
    ];
    await landReport(1000);
    expect((await estimate()).totalToken).toBe(1013);

    // Repeating `{{text}}` expands stored "hi" to 20k chars; empty draft stays empty.
    mocks.inputTemplate = '{{text}}'.repeat(10_000);
    const expanded = await estimate();
    expect(expanded.totalToken).toBeGreaterThan(20_000);
  });

  it('U3: a pending template change plus draft cannot hide historical expansion', async () => {
    mocks.chats = [
      { content: 'hi', id: 'u1', role: 'user' },
      { content: LOADING_FLAT, id: 'a1', role: 'assistant' },
    ];
    await dispatchWitness('a1', 'u1');

    mocks.inputTemplate = '{{text}}'.repeat(10_000);
    const whilePending = await estimate();
    expect(whilePending.inputToken).toBe(0);
    expect(whilePending.totalToken).toBeGreaterThan(20_000);

    const withDraft = await estimateContextUsageAsync({
      agentState: {} as any,
      chatState: { activeId: 'session-1', activeTopicId: 'topic-1', inputMessage: 'd' } as any,
    });
    // Draft "d" expands to 10k — below the 20k historical "hi" expansion.
    expect(withDraft.inputToken).toBe(10_000);
    expect(withDraft.totalToken - withDraft.inputToken).toBeGreaterThan(20_000);

    mocks.chats = [
      mocks.chats[0],
      { content: 'ok', id: 'a1', metadata: { totalInputTokens: 1000 }, role: 'assistant' },
    ];
    const afterReport = await estimate();
    expect(afterReport.inputToken).toBe(0);
    expect(afterReport.totalToken).toBeGreaterThan(20_000);
  });
});
