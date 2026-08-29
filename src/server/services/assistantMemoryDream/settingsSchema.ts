import { AgentChatConfigSchema } from '@lobechat/types';
import { z } from 'zod';

export const saveDreamMemorySettingsInputSchema = z.object({
  agentId: z.string(),
  chatConfig: AgentChatConfigSchema.pick({
    enableUserMemoryArchive: true,
    memoryDreamMaxEntries: true,
    memoryDreamScheduleFrequency: true,
    memoryDreamScheduleTime: true,
    memoryDreamScheduleWeekday: true,
  }).partial(),
});
