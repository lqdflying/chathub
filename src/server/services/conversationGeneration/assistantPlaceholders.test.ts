/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LOADING_FLAT } from '@lobechat/const';

import {
  annotateAssistantError,
  clearOperationPlaceholders,
  clearUnfinishedPlaceholders,
  listOperationAssistantIds,
} from './assistantPlaceholders';

const messageMocks = vi.hoisted(() => ({
  findById: vi.fn(),
  update: vi.fn(),
}));

const modelMocks = vi.hoisted(() => ({
  findById: vi.fn(),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: class {
    findById = messageMocks.findById;
    update = messageMocks.update;
  },
}));

vi.mock('@/database/models/conversationGeneration', () => ({
  ConversationGenerationModel: class {
    findById = modelMocks.findById;
  },
}));

describe('assistant placeholder cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('includes the parent assistant and tracked supervisor children', () => {
    expect(
      listOperationAssistantIds({
        assistantMessageId: 'parent-1',
        config: { model: 'm', provider: 'p', supervisorChildMessageIds: ['child-1', 'child-2'] },
      } as any),
    ).toEqual(['parent-1', 'child-1', 'child-2']);
  });

  it('clears only LOADING_FLAT rows and never stamps an error onto finished content', async () => {
    const rows: Record<string, { content: string; error?: unknown }> = {
      'child-loading': { content: LOADING_FLAT },
      'child-done': { content: 'already answered' },
    };
    messageMocks.findById.mockImplementation(async (id: string) => rows[id]);
    messageMocks.update.mockImplementation(async (id: string, value: object) => {
      Object.assign(rows[id], value);
    });

    await clearUnfinishedPlaceholders({} as any, 'user-1', [
      'child-loading',
      'child-done',
      'missing',
    ]);

    expect(rows['child-loading'].content).toBe('');
    expect(rows['child-done']).toEqual({ content: 'already answered' });
    expect(messageMocks.update).toHaveBeenCalledTimes(1);
  });

  it('annotates only the failed assistant id', async () => {
    const rows: Record<string, { content: string; error?: unknown }> = {
      'child-failed': { content: 'partial answer' },
    };
    messageMocks.findById.mockImplementation(async (id: string) => rows[id]);
    messageMocks.update.mockImplementation(async (id: string, value: object) => {
      Object.assign(rows[id], value);
    });

    await annotateAssistantError({} as any, 'user-1', 'child-failed', {
      message: 'member failed',
      type: 'GroupAgentError',
    });

    expect(rows['child-failed']).toMatchObject({
      content: 'partial answer',
      error: { message: 'member failed', type: 'GroupAgentError' },
    });
  });

  it('falls back to the supplied operation when the latest row is missing', async () => {
    modelMocks.findById.mockResolvedValue(undefined);
    messageMocks.findById.mockResolvedValue({ content: LOADING_FLAT, id: 'child-1' });
    messageMocks.update.mockResolvedValue(undefined);

    await clearOperationPlaceholders(
      {} as any,
      {
        assistantMessageId: null,
        config: { model: 'm', provider: 'p', supervisorChildMessageIds: ['child-1'] },
        id: 'cgo-1',
        userId: 'user-1',
      } as any,
    );

    expect(messageMocks.update).toHaveBeenCalledWith('child-1', { content: '' });
  });
});
