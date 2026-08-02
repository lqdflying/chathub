import { MessageTextChunk } from '@lobechat/fetch-sse';
import {
  chainPickEmoji,
  chainSummaryAgentName,
  chainSummaryDescription,
  chainSummaryTags,
} from '@lobechat/prompts';
import { TraceNameMap, TracePayload, TraceTopicType } from '@lobechat/types';
import { getSingletonAnalyticsOptional } from '@lobehub/analytics';
import type { PartialDeep } from 'type-fest';
import { StateCreator } from 'zustand/vanilla';

import { chatService } from '@/services/chat';
import { globalHelpers } from '@/store/global/helpers';
import { useUserStore } from '@/store/user';
import { systemAgentSelectors } from '@/store/user/slices/settings/selectors';
import { LobeAgentChatConfig, LobeAgentConfig } from '@/types/agent';
import { MetaData } from '@/types/meta';
import { SystemAgentItem } from '@/types/user/settings';
import { merge } from '@/utils/merge';
import { setNamespace } from '@/utils/storeDebug';

import { LoadingState } from '../store/initialState';
import { State, initialState } from './initialState';
import { ConfigDispatch, configReducer } from './reducers/config';
import { MetaDataDispatch, metaDataReducer } from './reducers/meta';

export interface PublicAction {
  /**
   * 自动选择表情
   * @param id - 表情的 ID
   */
  autoPickEmoji: () => Promise<void>;
  /**
   * 自动完成代理描述
   * @param id - 代理的 ID
   * @returns 一个 Promise，用于异步操作完成后的处理
   */
  autocompleteAgentDescription: () => Promise<void>;
  autocompleteAgentTags: () => Promise<void>;
  /**
   * 自动完成代理标题
   * @param id - 代理的 ID
   * @returns 一个 Promise，用于异步操作完成后的处理
   */
  autocompleteAgentTitle: () => Promise<void>;
  /**
   * 自动完成助理元数据
   */
  autocompleteAllMeta: (replace?: boolean) => void;
  autocompleteMeta: (key: keyof MetaData) => void;
}

export interface Action extends PublicAction {
  dispatchConfig: (payload: ConfigDispatch) => Promise<void>;
  dispatchMeta: (payload: MetaDataDispatch) => Promise<void>;
  getCurrentTracePayload: (data: Partial<TracePayload>) => TracePayload;

  internal_getSystemAgentForMeta: () => SystemAgentItem;
  resetAgentConfig: () => Promise<void>;

  resetAgentMeta: () => Promise<void>;
  setAgentConfig: (config: PartialDeep<LobeAgentConfig>) => Promise<void>;
  setAgentMeta: (meta: Partial<MetaData>) => Promise<void>;

  setChatConfig: (config: Partial<LobeAgentChatConfig>) => Promise<void>;
  streamUpdateMetaArray: (key: keyof MetaData) => any;
  streamUpdateMetaString: (key: keyof MetaData) => any;
  toggleAgentPlugin: (pluginId: string, state?: boolean) => void;

  /**
   * 更新加载状态
   * @param key - SessionLoadingState 的键
   * @param value - 加载状态的值
   */
  updateLoadingState: (key: keyof LoadingState, value: boolean) => void;
}

export type Store = Action & State;

const t = setNamespace('AgentSettings');

// Max length of the `agents.description` column (varchar(1000)).
// Defensive cap so a verbose model response can never break the UPDATE query.
const DESCRIPTION_MAX_LENGTH = 1000;
const TAGS_MAX_COUNT = 5;

/**
 * Strip the `输入: {...} [locale] 输出:` scaffold that some models (e.g. Kimi)
 * echo back verbatim from our few-shot summarisation prompts, and trim any
 * stray wrapping punctuation the model adds around the real answer.
 */
const cleanSummaryOutput = (raw: string): string => {
  if (!raw) return raw;

  let text = raw;

  // If the model echoed the `输出:` / `输出：` label, keep only what follows
  // the last marker. We use the last occurrence so nested examples don't trip
  // us up.
  const outputMarker = /输出\s*[:：]/g;
  let lastIndex = -1;
  let match: RegExpExecArray | null;
  while ((match = outputMarker.exec(text)) !== null) {
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex !== -1) {
    text = text.slice(lastIndex);
  }

  text = text.trim();

  // Strip wrapping braces / quotes that some models add: `{foo}` or `"foo"`.
  if (
    (text.startsWith('{') && text.endsWith('}')) ||
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith('「') && text.endsWith('」'))
  ) {
    text = text.slice(1, -1).trim();
  }

  return text;
};

export const store: StateCreator<Store, [['zustand/devtools', never]]> = (set, get) => ({
  ...initialState,
  autoPickEmoji: async () => {
    const { config, meta, dispatchMeta } = get();

    const systemRole = config.systemRole;

    chatService.fetchPresetTaskResult({
      onFinish: async (emoji) => {
        dispatchMeta({ type: 'update', value: { avatar: emoji } });
      },
      onLoadingChange: (loading) => {
        get().updateLoadingState('avatar', loading);
      },
      params: merge(
        get().internal_getSystemAgentForMeta(),
        chainPickEmoji([meta.title, meta.description, systemRole].filter(Boolean).join(',')),
      ),
      trace: get().getCurrentTracePayload({ traceName: TraceNameMap.EmojiPicker }),
    });
  },
  autocompleteAgentDescription: async () => {
    const { dispatchMeta, config, meta, updateLoadingState, streamUpdateMetaString } = get();

    const systemRole = config.systemRole;

    if (!systemRole) return;

    const preValue = meta.description;

    // 替换为 ...
    dispatchMeta({ type: 'update', value: { description: '...' } });

    chatService.fetchPresetTaskResult({
      onError: () => {
        dispatchMeta({ type: 'update', value: { description: preValue } });
      },
      onLoadingChange: (loading) => {
        updateLoadingState('description', loading);
      },
      onMessageHandle: streamUpdateMetaString('description'),
      params: merge(
        get().internal_getSystemAgentForMeta(),
        chainSummaryDescription(systemRole, globalHelpers.getCurrentLanguage()),
      ),
      trace: get().getCurrentTracePayload({ traceName: TraceNameMap.SummaryAgentDescription }),
    });
  },
  autocompleteAgentTags: async () => {
    const { dispatchMeta, config, meta, updateLoadingState, streamUpdateMetaArray } = get();

    const systemRole = config.systemRole;

    if (!systemRole) return;

    const preValue = meta.tags;

    // 替换为 ...
    dispatchMeta({ type: 'update', value: { tags: ['...'] } });

    // Get current agent for agentMeta
    chatService.fetchPresetTaskResult({
      onError: () => {
        dispatchMeta({ type: 'update', value: { tags: preValue } });
      },
      onLoadingChange: (loading) => {
        updateLoadingState('tags', loading);
      },
      onMessageHandle: streamUpdateMetaArray('tags'),
      params: merge(
        get().internal_getSystemAgentForMeta(),
        chainSummaryTags(
          [meta.title, meta.description, systemRole].filter(Boolean).join(','),
          globalHelpers.getCurrentLanguage(),
        ),
      ),
      trace: get().getCurrentTracePayload({ traceName: TraceNameMap.SummaryAgentTags }),
    });
  },
  autocompleteAgentTitle: async () => {
    const { dispatchMeta, config, meta, updateLoadingState, streamUpdateMetaString } = get();

    const systemRole = config.systemRole;

    if (!systemRole) return;

    const previousTitle = meta.title;

    // 替换为 ...
    dispatchMeta({ type: 'update', value: { title: '...' } });

    chatService.fetchPresetTaskResult({
      onError: () => {
        dispatchMeta({ type: 'update', value: { title: previousTitle } });
      },
      onLoadingChange: (loading) => {
        updateLoadingState('title', loading);
      },
      onMessageHandle: streamUpdateMetaString('title'),
      params: merge(
        get().internal_getSystemAgentForMeta(),
        chainSummaryAgentName(
          [meta.description, systemRole].filter(Boolean).join(','),
          globalHelpers.getCurrentLanguage(),
        ),
      ),
      trace: get().getCurrentTracePayload({ traceName: TraceNameMap.SummaryAgentTitle }),
    });
  },
  autocompleteAllMeta: (replace) => {
    const { meta } = get();

    if (!meta.title || replace) {
      get().autocompleteAgentTitle();
    }

    if (!meta.description || replace) {
      get().autocompleteAgentDescription();
    }

    if (!meta.avatar || replace) {
      get().autoPickEmoji();
    }

    if (!meta.tags || replace) {
      get().autocompleteAgentTags();
    }
  },
  autocompleteMeta: (key) => {
    const {
      autoPickEmoji,
      autocompleteAgentTitle,
      autocompleteAgentDescription,
      autocompleteAgentTags,
    } = get();

    switch (key) {
      case 'avatar': {
        autoPickEmoji();
        return;
      }

      case 'description': {
        autocompleteAgentDescription();
        return;
      }

      case 'title': {
        autocompleteAgentTitle();
        return;
      }

      case 'tags': {
        autocompleteAgentTags();
        return;
      }
    }
  },
  dispatchConfig: async (payload) => {
    const nextConfig = configReducer(get().config, payload);

    set({ config: nextConfig }, false, payload);

    await get().onConfigChange?.(nextConfig);
  },
  dispatchMeta: async (payload) => {
    const nextValue = metaDataReducer(get().meta, payload);

    set({ meta: nextValue }, false, payload);

    await get().onMetaChange?.(nextValue);
  },
  getCurrentTracePayload: (data) => ({
    sessionId: get().id,
    topicId: TraceTopicType.AgentSettings,
    ...data,
  }),

  internal_getSystemAgentForMeta: () => {
    return systemAgentSelectors.agentMeta(useUserStore.getState());
  },

  resetAgentConfig: async () => {
    await get().dispatchConfig({ type: 'reset' });
  },

  resetAgentMeta: async () => {
    await get().dispatchMeta({ type: 'reset' });
  },
  setAgentConfig: async (config) => {
    await get().dispatchConfig({ config, type: 'update' });
  },
  setAgentMeta: async (meta) => {
    const { dispatchMeta, id, meta: currentMeta } = get();
    const mergedMeta = merge(currentMeta, meta);

    try {
      const analytics = getSingletonAnalyticsOptional();
      if (analytics) {
        analytics.track({
          name: 'agent_meta_updated',
          properties: {
            assistant_avatar: mergedMeta.avatar,
            assistant_background_color: mergedMeta.backgroundColor,
            assistant_description: mergedMeta.description,
            assistant_name: mergedMeta.title,
            assistant_tags: mergedMeta.tags,
            is_inbox: id === 'inbox',
            session_id: id || 'unknown',
            timestamp: Date.now(),
            user_id: useUserStore.getState().user?.id || 'anonymous',
          },
        });
      }
    } catch (error) {
      console.warn('Failed to track agent meta update:', error);
    }
    await dispatchMeta({ type: 'update', value: meta });
  },

  setChatConfig: async (config) => {
    await get().setAgentConfig({ chatConfig: config });
  },

  streamUpdateMetaArray: (key: keyof MetaData) => {
    let raw = '';
    return (chunk: MessageTextChunk) => {
      switch (chunk.type) {
        case 'text': {
          raw += chunk.text;
          const cleaned = cleanSummaryOutput(raw);
          const tags = Array.from(
            new Set(
              cleaned
                .split(/[,，]/)
                .map((tag) => tag.trim())
                .filter(Boolean),
            ),
          ).slice(0, TAGS_MAX_COUNT);
          get().dispatchMeta({ type: 'update', value: { [key]: tags } });
        }
      }
    };
  },

  streamUpdateMetaString: (key: keyof MetaData) => {
    let raw = '';
    return (chunk: MessageTextChunk) => {
      switch (chunk.type) {
        case 'text': {
          raw += chunk.text;
          let cleaned = cleanSummaryOutput(raw);
          // Guard against models that echo the entire input back and blow past
          // the 1000-char `agents.description` column limit.
          if (key === 'description' && cleaned.length > DESCRIPTION_MAX_LENGTH) {
            cleaned = cleaned.slice(0, DESCRIPTION_MAX_LENGTH);
          }
          get().dispatchMeta({ type: 'update', value: { [key]: cleaned } });
        }
      }
    };
  },

  toggleAgentPlugin: (id, state) => {
    get().dispatchConfig({ pluginId: id, state, type: 'togglePlugin' });
  },

  updateLoadingState: (key, value) => {
    set(
      { loadingState: { ...get().loadingState, [key]: value } },
      false,
      t('updateLoadingState', { key, value }),
    );
  },
});
