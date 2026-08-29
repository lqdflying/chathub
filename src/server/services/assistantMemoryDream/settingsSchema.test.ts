import { describe, expect, it } from 'vitest';

import { saveDreamMemorySettingsInputSchema } from './settingsSchema';

describe('saveDreamMemorySettingsInputSchema', () => {
  it('accepts canonical UTC HH:mm schedule times', () => {
    expect(
      saveDreamMemorySettingsInputSchema.parse({
        agentId: 'agent-1',
        chatConfig: { memoryDreamScheduleTime: '00:00' },
      }).chatConfig.memoryDreamScheduleTime,
    ).toBe('00:00');
    expect(
      saveDreamMemorySettingsInputSchema.parse({
        agentId: 'agent-1',
        chatConfig: { memoryDreamScheduleTime: '23:59' },
      }).chatConfig.memoryDreamScheduleTime,
    ).toBe('23:59');
  });

  it('rejects invalid schedule times', () => {
    expect(() =>
      saveDreamMemorySettingsInputSchema.parse({
        agentId: 'agent-1',
        chatConfig: { memoryDreamScheduleTime: '24:00' },
      }),
    ).toThrow();
    expect(() =>
      saveDreamMemorySettingsInputSchema.parse({
        agentId: 'agent-1',
        chatConfig: { memoryDreamScheduleTime: 'not-a-time' },
      }),
    ).toThrow();
  });
});
