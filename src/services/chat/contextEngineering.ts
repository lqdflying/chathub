import { INBOX_GUIDE_SYSTEMROLE, INBOX_SESSION_ID } from '@lobechat/const';
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
  ToolSystemRoleProvider,
} from '@lobechat/context-engine';
import { agentMemoryPrompt, historySummaryPrompt } from '@lobechat/prompts';
import { OpenAIChatMessage, UIChatMessage } from '@lobechat/types';
import { VARIABLE_GENERATORS } from '@lobechat/utils/client';

import { isCanUseFC } from '@/helpers/isCanUseFC';
import { lambdaClient } from '@/libs/trpc/client';
import { getToolStoreState } from '@/store/tool';
import { toolSelectors } from '@/store/tool/selectors';

import { isCanUseVideo, isCanUseVision } from './helper';

const WEBAPI_FILES_PREFIX = '/webapi/files/';

/**
 * After MCP tool calls, refreshMessages() re-fetches messages from the server using
 * getUIFileUrl(), which returns auth-required /webapi/files/<key> proxy URLs instead of
 * the original S3 public URLs. AI providers cannot access these proxy URLs.
 * This function resolves them back to public S3 URLs via tRPC before the pipeline runs.
 */
const resolveProxyImageUrls = async (messages: UIChatMessage[]): Promise<UIChatMessage[]> => {
  const hasProxyUrls = messages.some((m) =>
    (m as any).imageList?.some((img: any) => img.url?.includes(WEBAPI_FILES_PREFIX)),
  );
  if (!hasProxyUrls) return messages;

  return Promise.all(
    messages.map(async (message) => {
      const imageList: any[] = (message as any).imageList;
      if (!imageList?.some((img) => img.url?.includes(WEBAPI_FILES_PREFIX))) return message;

      const resolvedImageList = await Promise.all(
        imageList.map(async (img) => {
          if (!img.url?.includes(WEBAPI_FILES_PREFIX)) return img;
          try {
            const resolvedUrl = await lambdaClient.file.resolvePublicUrl.query({ url: img.url });
            return { ...img, url: resolvedUrl };
          } catch {
            // stale/unowned key (e.g. the file was deleted elsewhere): keep the proxy URL so
            // the send proceeds — the provider gets an unreachable URL instead of a hard failure
            return img;
          }
        }),
      );
      return { ...message, imageList: resolvedImageList } as UIChatMessage;
    }),
  );
};

interface ContextEngineeringContext {
  agentMemory?: { dynamicMemory?: string; fixedMemory?: string };
  enableHistoryCount?: boolean;
  existingSystemRolePolicy?: 'prepend' | 'skip';
  historyCount?: number;
  historySummary?: string;
  inputTemplate?: string;
  isWelcomeQuestion?: boolean;
  messages: UIChatMessage[];
  model: string;
  provider: string;
  sessionId?: string;
  skills?: {
    activated?: Array<{
      description: string;
      identifier: string;
      instructions?: string;
      name: string;
    }>;
    available?: Array<{
      description: string;
      identifier: string;
      instructions?: string;
      name: string;
    }>;
  };
  systemRole?: string;
  tools?: string[];
}

export const contextEngineering = async ({
  agentMemory,
  messages = [],
  tools,
  model,
  provider,
  systemRole,
  skills,
  inputTemplate,
  enableHistoryCount,
  existingSystemRolePolicy,
  historyCount,
  historySummary,
  sessionId,
  isWelcomeQuestion,
}: ContextEngineeringContext): Promise<OpenAIChatMessage[]> => {
  const toolNameResolver = new ToolNameResolver();

  const pipeline = new ContextEngine({
    pipeline: [
      // 1. History truncation (MUST be first, before any message injection)
      new HistoryTruncateProcessor({ enableHistoryCount, historyCount }),

      // --------- Create system role injection providers

      // 2. System role injection (agent's system role)
      new SystemRoleInjector({ existingSystemRolePolicy, systemRole }),

      // 2.5 Two-tier agent memory injection (fixed + dynamic). Placed right after the
      // system role so the rarely-changing memory block stays in the stable prompt
      // prefix, ahead of the more volatile blocks below (prompt-cache stability).
      new AgentMemoryProvider({ ...agentMemory, formatAgentMemory: agentMemoryPrompt }),

      new SkillInstructionsProvider(skills),

      // 3. Inbox guide system role injection
      new InboxGuideProvider({
        inboxGuideSystemRole: INBOX_GUIDE_SYSTEMROLE,
        inboxSessionId: INBOX_SESSION_ID,
        isWelcomeQuestion: isWelcomeQuestion,
        sessionId: sessionId,
      }),

      // 4. Tool system role injection
      new ToolSystemRoleProvider({
        getToolSystemRoles: (tools) => toolSelectors.enabledSystemRoles(tools)(getToolStoreState()),
        isCanUseFC,
        model,
        provider,
        tools,
      }),

      // 5. History summary injection
      new HistorySummaryProvider({
        formatHistorySummary: historySummaryPrompt,
        historySummary: historySummary,
      }),

      // Create message processing processors

      // 6. Input template processing
      new InputTemplateProcessor({
        inputTemplate,
      }),

      // 7. Placeholder variables processing
      new PlaceholderVariablesProcessor({
        provider,
        variableGenerators: VARIABLE_GENERATORS,
      }),

      // 8. Message content processing
      new MessageContentProcessor({
        fileContext: { enabled: true, includeFileUrl: true },
        isCanUseVideo,
        isCanUseVision,
        model,
        provider,
      }),

      // 10. Tool call processing
      new ToolCallProcessor({
        genToolCallingName: toolNameResolver.generate.bind(toolNameResolver),
        isCanUseFC,
        model,
        provider,
      }),

      // 11. Tool message reordering
      new ToolMessageReorder(),

      // 12. Message cleanup (final step, keep only necessary fields)
      new MessageCleanupProcessor(),
    ],
  });

  const resolvedMessages = await resolveProxyImageUrls(messages);
  const result = await pipeline.process({ messages: resolvedMessages });

  return result.messages;
};
