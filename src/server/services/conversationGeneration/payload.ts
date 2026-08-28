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
import { agentMemoryPrompt, historySummaryPrompt, pluginPrompts } from '@lobechat/prompts';
import type {
  ConversationGenerationConfigSnapshot,
  OpenAIChatMessage,
  UIChatMessage,
} from '@lobechat/types';
import { MAX_ACTIVE_SKILLS } from '@lobechat/types';
import type { LobeChatPluginManifest } from '@lobehub/chat-plugin-sdk';

import { PluginModel } from '@/database/models/plugin';
import { SkillModel } from '@/database/models/skill';
import {
  getMessagesAfterHistorySummaryCursor,
  resolveEffectiveHistoryWindow,
} from '@/helpers/contextCompaction';
import { getModelContextWindowTokens } from '@/helpers/modelContextWindowTokens';
import { composeSystemRole } from '@/services/chat/composeSystemRole';
import {
  buildModelExtendParams,
  resolveModelSearchConfig,
} from '@/services/chat/requestShaping';
import { trimMinimaxChatContext } from '@/services/chat/trimMinimaxContext';
import { FileService } from '@/server/services/file';
import { builtinTools } from '@/tools';
import { MemoryManifest } from '@/tools/memory';
import { SkillLoaderManifest } from '@/tools/skills';
import { WebBrowsingManifest } from '@/tools/web-browsing';
import type { LobeChatDatabase } from '@lobechat/database';

import type { ConversationRuntimeState } from './credentials';
import { resolveConversationInboxSessionId } from './inboxSession';
import { createServerPlaceholderGenerators } from './placeholders';

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
  const providerRuntime = runtimeState.runtimeConfig?.[provider];
  const searchConfig = resolveModelSearchConfig({
    modelSearchImpl: modelCard?.settings?.searchImpl,
    provider,
    providerHasBuiltinSearch: Boolean(providerRuntime?.settings?.searchMode),
    searchMode: chatConfig?.searchMode,
    useModelBuiltinSearch: chatConfig?.useModelBuiltinSearch,
  });
  const canUseFC = Boolean(modelCard?.abilities?.functionCall);
  const canUseVision = Boolean(modelCard?.abilities?.vision);
  const canUseVideo = Boolean(modelCard?.abilities?.video);
  const installed = await new PluginModel(db, userId).query();
  const pluginManifests = installed
    .map((item) => item.manifest)
    .filter(Boolean) as LobeChatPluginManifest[];
  const builtinManifests = builtinTools.map((tool) => tool.manifest as LobeChatPluginManifest);
  const defaultToolIds = [
    ...(searchConfig.useApplicationBuiltinSearchTool ? [WebBrowsingManifest.identifier] : []),
    ...(config.enableMemoryTool ? [MemoryManifest.identifier] : []),
  ];
  const toolsEngine = new ToolsEngine({
    defaultToolIds,
    enableChecker: ({ pluginId }) => {
      if (pluginId === SkillLoaderManifest.identifier) return false;
      if (pluginId === WebBrowsingManifest.identifier) {
        return searchConfig.useApplicationBuiltinSearchTool;
      }
      if (pluginId === MemoryManifest.identifier) return Boolean(config.enableMemoryTool);
      return pluginIds.includes(pluginId);
    },
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
  const messagesAfterSummary = getMessagesAfterHistorySummaryCursor(
    messages,
    config.historySummaryLastMessageId,
  );
  const resolvedMessages = await resolveProxyImageUrls(messagesAfterSummary, fileService);
  const systemRole = composeSystemRole(generalInstruction, config.systemRole);
  const fixedOverheadTokensForHistory = Math.ceil(
    (systemRole.length + (tools?.map((item) => JSON.stringify(item)).join('').length ?? 0)) / 2,
  );
  const effectiveHistory = resolveEffectiveHistoryWindow({
    enableHistoryCount: chatConfig?.enableHistoryCount,
    fixedOverheadTokens: fixedOverheadTokensForHistory,
    historyCount: chatConfig?.historyCount,
    maxTokens: getModelContextWindowTokens(model, provider),
    messagesAfterCursor: resolvedMessages,
  });
  const pipeline = new ContextEngine({
    pipeline: [
      new HistoryTruncateProcessor({
        enableHistoryCount: effectiveHistory.enableHistoryCount,
        historyCount: effectiveHistory.historyCount,
      }),
      new SystemRoleInjector({ existingSystemRolePolicy: 'prepend', systemRole }),
      new AgentMemoryProvider({
        ...(chatConfig?.enableAssistantMemory === false ? {} : agentMemory),
        formatAgentMemory: agentMemoryPrompt,
      }),
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
        sessionId: resolveConversationInboxSessionId(sessionId),
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
        variableGenerators: createServerPlaceholderGenerators(profile, config.locale),
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
    oaiMessages = await trimMinimaxChatContext(
      oaiMessages,
      tools,
      model,
      config.agentParams?.max_tokens as number | undefined,
    );
  }

  const extendParams = {
    ...(config.agentParams || {}),
    ...buildModelExtendParams({
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
      enabledSearch: searchConfig.enabledSearch && searchConfig.useModelSearch ? true : undefined,
      messages: oaiMessages,
      model,
      provider,
      tools,
    },
    tools,
  };
};
