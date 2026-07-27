import type { PartialDeep } from 'type-fest';

import type { NewAgent, NewSession } from '@/database/schemas';
import type { LobeAgentSession } from '@/types/session';

export interface NormalizedAgentSession {
  config: Partial<NewAgent>;
  session: Partial<NewSession>;
}

export const normalizeAgentSession = (
  data: PartialDeep<LobeAgentSession>,
): NormalizedAgentSession => {
  const { config, group, meta, ...session } = data;

  return {
    config: { ...config, ...meta } as Partial<NewAgent>,
    session: { ...session, groupId: group } as Partial<NewSession>,
  };
};
