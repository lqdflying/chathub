import {
  AgentMemoryProvider,
  ContextEngine,
  HistorySummaryProvider,
  HistoryTruncateProcessor,
  InboxGuideProvider,
  InputTemplateProcessor,
  MessageCleanupProcessor,
  MessageContentProcessor,
  PlaceholderVariablesProcessor,
  SkillInstructionsProvider,
  SystemRoleInjector,
  ToolCallProcessor,
  ToolMessageReorder,
  ToolNameResolver,
  ToolsEngine,
  ToolSystemRoleProvider,
} from '@lobechat/context-engine';
import { INBOX_GUIDE_SYSTEMROLE, INBOX_SESSION_ID } from '@lobechat/const';
import { REASONING_BUDGET_TOKEN_ADAPTIVE, supportsAnthropicAdaptiveThinking } from '@lobechat/model-runtime';
import { agentMemoryPrompt, historySummaryPrompt, pluginPrompts } from '@lobechat/prompts';
import type {
  ConversationGenerationConfigSnapshot,
  LobeAgentChatConfig,
  OpenAIChatMessage,
  UIChatMessage,
} from '@lobechat/types';
import { MAX_ACTIVE_SKILLS, resolveGPT5ReasoningEffort } from '@lobechat/types';
import type { LobeChatPluginManifest } from '@lobehub/chat-plugin-sdk';
import { ModelProvider } from 'model-bank';

import { PluginModel } from '@/database/models/plugin';
import { SkillModel } from '@/database/models/skill';
import { inboxSessionId } from '@/database/utils/idGenerator';
import { composeSystemRole } from '@/services/chat/composeSystemRole';
import { trimMinimaxChatContext } from '@/services/chat/trimMinimaxContext';
import { FileService } from '@/server/services/file';
import { builtinTools } from '@/tools';
import { MemoryManifest } from '@/tools/memory';
import { WebBrowsingManifest } from '@/tools/web-browsing';
import type { LobeChatDatabase } from '@lobechat/database';

import type { ConversationRuntimeState } from './credentials';
import { createServerPlaceholderGenerators } from './placeholders';

const VALID_REASONING_EFFORTS = new Set(['low', 'medium', 'high']);
const isAnthropicRuntimeProvider = (provider?: string) =>
  provider === ModelProvider.Anthropic || provider === ModelProvider.AnthropicCompatible;

const WEBAPI_FILES_PREFIX = '/webapi/files/';

const extractKey = (url: string) => {
  const index = url.indexOf(WEBAPI_FILES_PREFIX);
  return index >= 0 ? url.slice(index + WEBAPI_FILES_PREFIX.length) : url;
};

const resolveProxyImageUrls = async (
  messages: UIChatMessage[],
  fileService: FileService,
): Promise<UIChatMessage[]> => {
  return Promise.all(
    messages.map(async (message) => {
      const imageList: any[] | undefined = (message as any).imageList;
      if (!imageList?.some((img) => img.url?.includes(WEBAPI_FILES_PREFIX))) return message;

      const resolvedImageList = await Promise.all(
        imageList.map(async (img) => {
          if (!img.url?.includes(WEBAPI_FILES_PREFIX)) return img;
          try {
            const resolvedUrl = await fileService.getFullFileUrl(extractKey(img.url));
            return { ...img, url: resolvedUrl || img.url };
          } catch {
            return img;
          }
        }),
      );
      return { ...message, imageList: resolvedImageList } as UIChatMessage;
    }),
  );
};

const buildExtendParams = ({
  chatConfig,
  model,
  modelExtendParams,
  provider,
}: {
  chatConfig?: Partial<LobeAgentChatConfig>;
  model: string;
  modelExtendParams?: string[];
  provider: string;
}) => {
  const extendParams: Record<string, any> = {};
  if (!chatConfig || !modelExtendParams?.length) return extendParams;

  if (modelExtendParams.includes('enableReasoning')) {
    if (chatConfig.enableReasoning) {
      if (
        isAnthropicRuntimeProvider(provider) &&
        chatConfig.reasoningBudgetToken === REASONING_BUDGET_TOKEN_ADAPTIVE &&
        supportsAnthropicAdaptiveThinking(model)
      ) {
        extendParams.thinking = {
          effort: VALID_REASONING_EFFORTS.has(chatConfig.reasoningEffort || '')
            ? chatConfig.reasoningEffort
            : 'high',
          type: 'adaptive',
        };
      } else {
        extendParams.thinking = {
          budget_tokens: chatConfig.reasoningBudgetToken || 1024,
          type: 'enabled',
          ...(model === 'kimi-k2.6' && chatConfig.moonshotPreservedReasoning
            ? { keep: 'all' as const }
            : {}),
          ...(provider === 'zhipu' && chatConfig.zhipuPreservedThinking
            ? { clear_thinking: false as const }
            : {}),
        };
      }
    } else {
      extendParams.thinking = { budget_tokens: 0, type: 'disabled' };
    }
  }

  if (modelExtendParams.includes('disableContextCaching') && chatConfig.disableContextCaching) {
    extendParams.enabledContextCaching = false;
  }

  if (modelExtendParams.includes('gpt5ReasoningEffort')) {
    const { effort, effortValues } = resolveGPT5ReasoningEffort(
      model,
      chatConfig.gpt5ReasoningEffort,
    );
    if (chatConfig.gpt5ReasoningEffort || effortValues[0] === 'high') {
      extendParams.reasoning_effort = effort;
    }
  }

  if (modelExtendParams.includes('textVerbosity') && chatConfig.textVerbosity) {
    extendParams.verbosity = chatConfig.textVerbosity;
  }

  if (modelExtendParams.includes('thinking') && chatConfig.thinking) {
    extendParams.thinking = { type: chatConfig.thinking };
  }

  if (modelExtendParams.includes('thinkingBudget') && chatConfig.thinkingBudget) {
    extendParams.thinkingBudget = chatConfig.thinkingBudget;
  }

  if (modelExtendParams.includes('urlContext') && chatConfig.urlContext) {
    extendParams.urlContext = chatConfig.urlContext;
  }

  if (modelExtendParams.includes('minimaxReasoningSplit')) {
    extendParams.reasoning_split = chatConfig.minimaxReasoningSplit !== false;
  }

  return extendParams;
};

export const buildConversationChatPayload = async ({
  agentMemory,
  config,
  db,
  generalInstruction,
  historySummary,
  messages,
  profile,
  runtimeState,
  sessionId,
  userId,
}: {
  agentMemory?: { dynamicMemory?: string; fixedMemory?: string };
  config: ConversationGenerationConfigSnapshot;
  db: LobeChatDatabase;
  generalInstruction?: string;
  historySummary?: string;
  messages: UIChatMessage[];
  profile?: {
    email?: string | null;
    fullName?: string | null;
    nickname?: string | null;
    username?: string | null;
  };
  runtimeState: ConversationRuntimeState;
  sessionId?: string | null;
  userId: string;
}) => {
  const model = config.model;
  const provider = config.provider;
  const chatConfig = config.chatConfig;
  const pluginIds = config.plugins || [];
  const skillIds = [...new Set(config.activatedSkillIds || [])].slice(0, MAX_ACTIVE_SKILLS);
  const skillRecords = (
    await Promise.all(skillIds.map((identifier) => new SkillModel(db, userId).findById(identifier)))
  ).filter(Boolean);
  const modelCard = runtimeState.enabledAiModels?.find(
    (item) => item.id === model && item.providerId === provider,
  );
  const canUseFC = modelCard?.abilities?.functionCall !== false;
  const canUseVision = Boolean(modelCard?.abilities?.vision);
  const canUseVideo = Boolean(modelCard?.abilities?.video);
  const installed = await new PluginModel(db, userId).query();
  const pluginManifests = installed
    .map((item) => item.manifest)
    .filter(Boolean) as LobeChatPluginManifest[];
  const builtinManifests = builtinTools.map((tool) => tool.manifest as LobeChatPluginManifest);
  const defaultToolIds = [
    WebBrowsingManifest.identifier,
    ...(config.enableMemoryTool ? [MemoryManifest.identifier] : []),
  ];
  const toolsEngine = new ToolsEngine({
    defaultToolIds,
    enableChecker: ({ pluginId }) =>
      pluginIds.includes(pluginId) || defaultToolIds.includes(pluginId),
    functionCallChecker: () => canUseFC,
    manifestSchemas: [...pluginManifests, ...builtinManifests],
  });
  const { tools, enabledToolIds } = toolsEngine.generateToolsDetailed({
    model,
    provider,
    toolIds: pluginIds,
  });
  const manifests = [...pluginManifests, ...builtinManifests];
  const toolNameResolver = new ToolNameResolver();
  const fileService = new FileService(db, userId);
  const resolvedMessages = await resolveProxyImageUrls(messages, fileService);
  const systemRole = composeSystemRole(generalInstruction, config.systemRole);
  const pipeline = new ContextEngine({
    pipeline: [
      new HistoryTruncateProcessor({
        enableHistoryCount: chatConfig?.enableHistoryCount,
        historyCount: chatConfig?.historyCount,
      }),
      new SystemRoleInjector({ existingSystemRolePolicy: 'prepend', systemRole }),
      new AgentMemoryProvider({ ...agentMemory, formatAgentMemory: agentMemoryPrompt }),
      new SkillInstructionsProvider({
        activated: skillRecords.map((skill) => ({
          description: skill!.description,
          identifier: skill!.identifier,
          instructions: skill!.instructions,
          name: skill!.name,
        })),
      }),
      new InboxGuideProvider({
        inboxGuideSystemRole: INBOX_GUIDE_SYSTEMROLE,
        inboxSessionId: INBOX_SESSION_ID,
        isWelcomeQuestion: config.isWelcomeQuestion,
        sessionId: sessionId ?? inboxSessionId(userId),
      }),
      new ToolSystemRoleProvider({
        getToolSystemRoles: (toolIds: string[]) => {
          const toolsSystemRole = manifests
            .filter((manifest) => manifest && toolIds.includes(manifest.identifier))
            .map((manifest) => ({
              apis: (manifest.api || []).map((api) => ({
                desc: api.description,
                name: toolNameResolver.generate(manifest.identifier, api.name, manifest.type),
              })),
              identifier: manifest.identifier,
              name: manifest.identifier,
              systemRole: manifest.systemRole || '',
            }));
          return toolsSystemRole.length > 0 ? pluginPrompts({ tools: toolsSystemRole }) : '';
        },
        isCanUseFC: () => canUseFC,
        model,
        provider,
        tools: enabledToolIds,
      }),
      new HistorySummaryProvider({
        formatHistorySummary: historySummaryPrompt,
        historySummary: historySummary || config.historySummary,
      }),
      new InputTemplateProcessor({ inputTemplate: chatConfig?.inputTemplate }),
      new PlaceholderVariablesProcessor({
        provider,
        variableGenerators: createServerPlaceholderGenerators(profile),
      }),
      new MessageContentProcessor({
        fileContext: { enabled: true, includeFileUrl: true },
        isCanUseVideo: () => canUseVideo,
        isCanUseVision: () => canUseVision,
        model,
        provider,
      }),
      new ToolCallProcessor({
        genToolCallingName: toolNameResolver.generate.bind(toolNameResolver),
        isCanUseFC: () => canUseFC,
        model,
        provider,
      }),
      new ToolMessageReorder(),
      new MessageCleanupProcessor(),
    ],
  });

  const processed = await pipeline.process({ messages: resolvedMessages });
  let oaiMessages = processed.messages as OpenAIChatMessage[];
  if (provider === 'minimax') {
    oaiMessages = await trimMinimaxChatContext(oaiMessages, tools, model);
  }

  const extendParams = {
    ...(config.agentParams || {}),
    ...buildExtendParams({
      chatConfig,
      model,
      modelExtendParams: modelCard?.settings?.extendParams,
      provider,
    }),
  };

  return {
    enabledToolIds,
    messages: oaiMessages,
    model,
    payload: {
      ...extendParams,
      messages: oaiMessages,
      model,
      provider,
      tools,
    },
    tools,
  };
};
