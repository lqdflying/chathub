import type { PartialDeep } from 'type-fest';

import { DEFAULT_AGENT_LOBE_SESSION } from '@/const/session';
import type { LobeAgentSession } from '@/types/session';
import { merge } from '@/utils/merge';

export const prepareAgentSession = (
  agent: PartialDeep<LobeAgentSession> | undefined,
  defaultAgentSettings: PartialDeep<LobeAgentSession> | undefined,
): LobeAgentSession => {
  const defaultAgent = merge(DEFAULT_AGENT_LOBE_SESSION, defaultAgentSettings);

  return merge(defaultAgent, agent);
};
