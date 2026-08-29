import { DEFAULT_AGENT_META } from '@/const/meta';
import { DEFAULT_AGENT_CONFIG } from '@/const/settings';
import { LobeAgentConfig } from '@/types/agent';
import { MetaData } from '@/types/meta';

export type LoadingState = Record<Partial<keyof MetaData> | string, boolean>;

export interface State {
  config: LobeAgentConfig;
  id?: string;
  loading?: boolean;
  loadingState?: LoadingState;
  meta: MetaData;
  /** May return a promise; `dispatchConfig` awaits it so write failures propagate to callers. */
  onConfigChange?: (config: LobeAgentConfig) => Promise<void> | void;
  onMetaChange?: (meta: MetaData) => void;
  /**
   * Refetch the displayed agent's config from the server. Surfaces wire this so
   * optimistic editors can converge on database truth after a failed write (a
   * rejection can also mean the write committed but the response was aborted).
   */
  onRefreshConfig?: () => Promise<void> | void;
}

export const initialState: State = {
  config: DEFAULT_AGENT_CONFIG,
  loading: true,
  loadingState: {
    avatar: false,
    backgroundColor: false,
    description: false,
    tags: false,
    title: false,
  },
  meta: DEFAULT_AGENT_META,
};
