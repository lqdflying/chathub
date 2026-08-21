/* eslint-disable sort-keys-fix/sort-keys-fix, typescript-sort-keys/interface */
// Disable the auto sort key eslint rule to make the code more logic and readable
import {
  GroupMemberInfo,
  buildGroupChatSystemPrompt,
  filterMessagesForAgent,
} from '@lobechat/prompts';
import {
  ChatErrorType,
  CreateMessageParams,
  SendGroupMessageParams,
  UIChatMessage,
} from '@lobechat/types';
import { nanoid } from '@lobechat/utils';
import debug from 'debug';
import { produce } from 'immer';
import { StateCreator } from 'zustand/vanilla';

import { LOADING_FLAT } from '@/const/message';
import { DEFAULT_CHAT_GROUP_CHAT_CONFIG } from '@/const/settings';
import {
  conversationGenerationIdempotencyKey,
  conversationGenerationRequestKey,
} from '@/helpers/conversationGenerationIdempotency';
import {
  buildDurableConversationConfig,
  isClientDurableConversationGenerationEnabled,
} from '@/helpers/durableConversationGeneration';
import { formatSupervisorTodoContent } from '@/helpers/supervisorTodos';
import { createGenerationDebugSpanId } from '@/libs/logger/generationDebugClient';
import { composeSystemRole } from '@/services/chat/composeSystemRole';
import {
  asConversationGenerationOperation,
  conversationGenerationService,
  isConversationGenerationDeferred,
  tryEnqueueConversationGeneration,
  waitForConversationGeneration,
} from '@/services/conversationGeneration';
import { messageService } from '@/services/message';
import { captureAccountMutationSnapshot, isAccountMutationCurrent } from '@/store/accountMutation';
import { ChatStore } from '@/store/chat/store';
import {
  isConversationClearFenceCurrent,
  laneScopedClearKey,
  resolveConversationClearGeneration,
  trackDurableEnqueue,
  untrackDurableEnqueue,
} from '@/store/chat/utils/conversationClearGeneration';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { globalHelpers } from '@/store/global/helpers';
import { useSessionStore } from '@/store/session';
import { sessionSelectors } from '@/store/session/selectors';
import { userGeneralSettingsSelectors, userProfileSelectors } from '@/store/user/selectors';
import { getUserStoreState } from '@/store/user/store';
import { merge } from '@/utils/merge';
import { setNamespace } from '@/utils/storeDebug';

import type { ChatStoreState } from '../../../initialState';
import { toggleBooleanList } from '../../../utils';
import {
  GroupChatSupervisor,
  SupervisorContext,
  SupervisorDecisionList,
  SupervisorTodoItem,
} from '../../message/supervisor';
import { notifyToolCallPersistenceFailure } from './persistenceNotification';

const n = setNamespace('aiGroupChat');
const log = debug('lobe-chat:group-chat');

const supervisor = new GroupChatSupervisor();

/**
 * Delay between sequential agent responses in milliseconds
 */
const SEQUENTIAL_RESPONSE_DELAY = 1500;

const getDebounceThreshold = (responseSpeed?: 'slow' | 'medium' | 'fast'): number => {
  switch (responseSpeed) {
    case 'fast': {
      return 1500;
    }
    case 'medium': {
      return 5000;
    }
    case 'slow': {
      return 8000;
    }
    default: {
      return 5000;
    }
  }
};

/**
 * Extract mentioned agent IDs from message content
 * Looks for <mention id="agentId">Name</mention> tags
 */
const extractMentionsFromContent = (
  content: string,
  groupMembers?: GroupMemberInfo[],
): string[] => {
  const mentionRegex = /<mention\s+[^>]*id="([^"]+)"[^>]*\/>/g;
  const mentions = new Set<string>();
  let match;

  while ((match = mentionRegex.exec(content)) !== null) {
    const mentionId = match[1];
    if (!mentionId) continue;

    if (mentionId === 'ALL_MEMBERS') {
      if (groupMembers?.length) {
        groupMembers.forEach((member) => {
          if (member.id) mentions.add(member.id);
        });
      }
      continue;
    }

    mentions.add(mentionId);
  }

  return [...mentions];
};

/**
 * Check if a message is a tool calling message that requires a follow-up
 */
const isToolCallMessage = (message: UIChatMessage): boolean => {
  return message.role === 'assistant' && !!message.tools && message.tools.length > 0;
};

/**
 * Count consecutive assistant messages from the end of the message list
 * This helps enforce maxResponseInRow limit
 */
const countConsecutiveAssistantMessages = (messages: UIChatMessage[]): number => {
  let count = 0;

  // Count from the end of the array backwards
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];

    // Stop counting if we hit a user message
    if (message.role === 'user') {
      break;
    }

    // Count assistant messages (including those from agents)
    if (message.role === 'assistant') {
      count++;
    }

    // Skip system and tool messages, continue counting
  }

  return count;
};

/**
 * Check if we should avoid supervisor decisions based on recent messages
 * Returns true if the conversation flow should continue without supervisor intervention
 */
const shouldAvoidSupervisorDecision = (
  messages: UIChatMessage[],
  maxResponseInRow?: number,
  isManualTrigger: boolean = false,
): boolean => {
  if (messages.length === 0) return true;

  const lastMessage = messages.at(-1);
  if (!lastMessage) return true;

  // Don't make decisions if the last message is a tool calling message
  // (it needs a follow-up assistant message)
  if (isToolCallMessage(lastMessage)) {
    return true;
  }

  // Don't make decisions if the last message is a tool response
  // (the conversation might still be in a tool calling sequence)
  if (lastMessage.role === 'tool') {
    return true;
  }

  // Only check maxResponseInRow limit for automatic triggers, not manual ones
  if (!isManualTrigger && maxResponseInRow && maxResponseInRow > 0) {
    const consecutiveCount = countConsecutiveAssistantMessages(messages);
    if (consecutiveCount >= maxResponseInRow) {
      console.log(
        `Avoiding automatic supervisor decision: ${consecutiveCount} consecutive assistant messages exceed limit of ${maxResponseInRow}`,
      );
      return true;
    }
  }

  return false;
};

export interface ChatGroupChatAction {
  /**
   * Sends a new message to a group chat and triggers agent responses
   */
  sendGroupMessage: (params: SendGroupMessageParams) => Promise<void>;

  // =========  ↓ Internal Group Chat Methods ↓  ========== //

  /**
   * Triggers supervisor decision for group chat
   */
  internal_triggerSupervisorDecision: (
    groupId: string,
    topicId?: string | null,
    isManualTrigger?: boolean,
    expectedConversationVersion?: number,
    contextExportCaptureId?: string,
  ) => Promise<void>;

  /**
   * Triggers supervisor decision with debounce logic (dynamic threshold based on group responseSpeed setting)
   * Fast: 1s, Medium: 2s, Slow: 5s, Default: 3s
   * Cancels previous pending decisions and schedules a new one
   */
  internal_triggerSupervisorDecisionDebounced: (
    groupId: string,
    expectedConversationVersion?: number,
    contextExportCaptureId?: string,
  ) => void;

  /** Route an already-persisted user message without creating a duplicate user row. */
  internal_routeGroupUserMessage: (
    groupId: string,
    message: Pick<UIChatMessage, 'content' | 'metadata' | 'targetId'>,
    immediateSupervisor?: boolean,
    expectedConversationVersion?: number,
    contextExportCaptureId?: string,
  ) => Promise<void>;

  /**
   * Cancels pending supervisor decision for a group
   */
  internal_cancelSupervisorDecision: (groupId: string, preservePendingCapture?: boolean) => void;

  /**
   * Cancels all pending supervisor decisions (cleanup method)
   */
  internal_cancelAllSupervisorDecisions: () => void;

  /**
   * Update supervisor todo list for a group/topic combination
   */
  internal_updateSupervisorTodos: (
    groupId: string,
    topicId: string | null | undefined,
    todos: SupervisorTodoItem[],
  ) => void;

  /**
   * Executes agent responses for group chat based on supervisor decisions
   */
  internal_executeAgentResponses: (
    groupId: string,
    decisions: SupervisorDecisionList,
    expectedConversationVersion?: number,
    contextExportCaptureId?: string,
  ) => Promise<void>;

  /**
   * Processes a single agent message in group chat
   */
  internal_processAgentMessage: (
    groupId: string,
    agentId: string,
    targetId?: string,
    instruction?: string,
    expectedConversationVersion?: number,
    contextExportCaptureId?: string,
    isToolContinuation?: boolean,
  ) => Promise<string | undefined>;

  /**
   * Sets the active group
   */
  internal_setActiveGroup: (groupId: string) => void;

  /**
   * Toggles supervisor loading state for group chat
   */
  internal_toggleSupervisorLoading: (loading: boolean, groupId?: string) => void;

  /**
   * Creates a supervisor error message for group chat
   */
  internal_createSupervisorErrorMessage: (
    groupId: string,
    error: Error | string,
    context?: string,
  ) => Promise<void>;
}

export const chatAiGroupChat: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  ChatGroupChatAction
> = (set, get) => {
  const pendingSupervisorCaptureIds = new Map<string, string>();

  const selectGroupConfig = (groupId: string) => {
    const { groupMaps } = get();
    const group = groupMaps[groupId];

    return merge(DEFAULT_CHAT_GROUP_CHAT_CONFIG, group?.config || {});
  };

  return {
    sendGroupMessage: async ({
      groupId,
      message,
      files,
      metadata,
      onlyAddUserMessage,
      targetMemberId,
    }) => {
      const accountMutationSnapshot = captureAccountMutationSnapshot(getUserStoreState());
      if (!accountMutationSnapshot) return;

      const {
        internal_createMessage,
        internal_routeGroupUserMessage,
        internal_setActiveGroup,
        activeTopicId,
      } = get();
      const conversationClearGeneration = get().conversationClearGeneration;
      const requestedSessionId = useSessionStore.getState().activeId;
      const isCurrentConversation = () =>
        isAccountMutationCurrent(getUserStoreState(), accountMutationSnapshot) &&
        get().conversationClearGeneration === conversationClearGeneration &&
        useSessionStore.getState().activeId === requestedSessionId &&
        get().activeTopicId === activeTopicId;

      if (!message.trim() && (!files || files.length === 0)) return;

      const expectedConversationVersion = await messageService.getConversationVersion();
      if (!isCurrentConversation()) return;
      internal_setActiveGroup(groupId);

      set({ isCreatingMessage: true }, false, n('creatingGroupMessage/start'));
      let contextExportCaptureId: string | undefined;

      try {
        const userMessage: CreateMessageParams = {
          content: message,
          files: files?.map((f) => f.id),
          role: 'user',
          groupId,
          metadata,
          sessionId: useSessionStore.getState().activeId,
          topicId: activeTopicId,
          targetId: targetMemberId,
        };

        const messageId = await internal_createMessage(userMessage, {
          expectedConversationVersion,
        });
        if (!isCurrentConversation()) return;

        // if only add user message, then stop
        if (onlyAddUserMessage) {
          set({ isCreatingMessage: false }, false, n('creatingGroupMessage/onlyUser'));
          return;
        }

        if (messageId) {
          contextExportCaptureId = get().consumeContextExportArm();
          await internal_routeGroupUserMessage(
            groupId,
            {
              content: message,
              metadata,
              targetId: targetMemberId,
            },
            false,
            expectedConversationVersion,
            contextExportCaptureId,
          );
        }
      } catch (error) {
        console.error('Failed to send group message:', error);
      } finally {
        if (
          contextExportCaptureId &&
          isCurrentConversation() &&
          pendingSupervisorCaptureIds.get(groupId) !== contextExportCaptureId
        ) {
          get().completeContextExport(contextExportCaptureId);
        }
        if (isCurrentConversation()) {
          set({ isCreatingMessage: false }, false, n('creatingGroupMessage/end'));
        }
      }
    },

    // ========= ↓ Group Chat Internal Methods ↓ ========== //

    internal_routeGroupUserMessage: async (
      groupId,
      message,
      immediateSupervisor = false,
      expectedConversationVersion,
      contextExportCaptureId,
    ) => {
      const accountMutationSnapshot = captureAccountMutationSnapshot(getUserStoreState());
      if (!accountMutationSnapshot) return;

      const conversationClearGeneration = get().conversationClearGeneration;
      const requestedSessionId = useSessionStore.getState().activeId;
      const requestedTopicId = get().activeTopicId;
      const isCurrentConversation = () =>
        isAccountMutationCurrent(getUserStoreState(), accountMutationSnapshot) &&
        get().conversationClearGeneration === conversationClearGeneration &&
        useSessionStore.getState().activeId === requestedSessionId &&
        get().activeTopicId === requestedTopicId;
      const resolvedConversationVersion =
        expectedConversationVersion ?? (await messageService.getConversationVersion());
      if (!isCurrentConversation()) return;

      // Use the specific group's config rather than relying on whichever session is active later.
      const groupConfig = selectGroupConfig(groupId);

      if (groupConfig?.enableSupervisor) {
        if (immediateSupervisor) {
          if (contextExportCaptureId) {
            await get().internal_triggerSupervisorDecision(
              groupId,
              get().activeTopicId,
              true,
              resolvedConversationVersion,
              contextExportCaptureId,
            );
          } else {
            await get().internal_triggerSupervisorDecision(
              groupId,
              get().activeTopicId,
              true,
              resolvedConversationVersion,
            );
          }
        } else {
          if (!isCurrentConversation()) return;
          get().internal_triggerSupervisorDecisionDebounced(
            groupId,
            resolvedConversationVersion,
            contextExportCaptureId,
          );
        }
        return;
      }

      const agents = sessionSelectors.currentGroupAgents(useSessionStore.getState());
      const mentionableGroupAgents: GroupMemberInfo[] = agents.map((agent) => ({
        id: agent.id,
        title: agent.title ?? agent.id,
      }));
      const candidateAgentIds = new Set(
        extractMentionsFromContent(message.content, mentionableGroupAgents),
      );

      if (message.targetId && agents.some((agent) => agent.id === message.targetId)) {
        candidateAgentIds.add(message.targetId);
      }

      const validAgentIds = [...candidateAgentIds].filter((agentId) =>
        agents.some((agent) => agent.id === agentId),
      );
      if (validAgentIds.length === 0) return;

      if (!isCurrentConversation()) return;
      await get().internal_executeAgentResponses(
        groupId,
        validAgentIds.map((agentId) => ({
          id: agentId,
          target: message.targetId === agentId ? 'user' : undefined,
        })),
        resolvedConversationVersion,
        contextExportCaptureId,
      );
    },

    internal_triggerSupervisorDecision: async (
      groupId: string,
      topicId?: string | null,
      isManualTrigger: boolean = false,
      expectedConversationVersion?: number,
      contextExportCaptureId?: string,
    ) => {
      const accountMutationSnapshot = captureAccountMutationSnapshot(getUserStoreState());
      if (!accountMutationSnapshot) return;

      const conversationClearGeneration = get().conversationClearGeneration;
      const requestedSessionId = useSessionStore.getState().activeId;
      const currentTopicId = typeof topicId === 'undefined' ? get().activeTopicId : topicId;
      // Full clear fence (global + topic tombstone): topic deletion never bumps
      // the global epoch, so only the resolved fence detects it before the
      // in-flight key is registered or a returned operation is attached.
      const requestedClearFence = resolveConversationClearGeneration(
        get(),
        requestedSessionId,
        currentTopicId ?? null,
        null,
        'group_supervisor',
      );
      const isCurrentConversation = () =>
        isAccountMutationCurrent(getUserStoreState(), accountMutationSnapshot) &&
        get().conversationClearGeneration === conversationClearGeneration &&
        useSessionStore.getState().activeId === requestedSessionId &&
        get().activeTopicId === currentTopicId &&
        isConversationClearFenceCurrent(
          get(),
          requestedClearFence,
          requestedSessionId,
          currentTopicId ?? null,
          null,
          'group_supervisor',
        );
      const resolvedConversationVersion =
        expectedConversationVersion ?? (await messageService.getConversationVersion());
      if (!isCurrentConversation()) return;
      const {
        messagesMap,
        internal_toggleSupervisorLoading,
        internal_createMessage,
        supervisorTodos,
      } = get();

      // Always read config for the provided groupId early so it can be used in createSupervisorTodoMessage
      const groupConfig = selectGroupConfig(groupId);

      const createSupervisorTodoMessage = async (todoList: SupervisorTodoItem[]) => {
        if (!groupId) return;

        const sessionId = useSessionStore.getState().activeId || groupId;
        if (!sessionId) return;

        const content = formatSupervisorTodoContent(todoList);
        const supervisorMessage: CreateMessageParams = {
          content,
          fromModel: groupConfig.orchestratorModel,
          fromProvider: groupConfig.orchestratorProvider,
          groupId,
          role: 'supervisor',
          sessionId,
          topicId: currentTopicId ?? undefined,
        };

        console.log('Creating supervisor todo message:', supervisorMessage);

        if (!isCurrentConversation()) return;
        await internal_createMessage(supervisorMessage, {
          expectedConversationVersion: resolvedConversationVersion,
        });
      };

      const messages = messagesMap[messageMapKey(groupId, currentTopicId)] || [];
      const agents = sessionSelectors.currentGroupAgents(useSessionStore.getState());

      if (messages.length === 0) return;

      // If supervisor is disabled, skip supervisor decision
      if (!groupConfig?.enableSupervisor) {
        console.log('Supervisor is disabled for this group, skipping supervisor decision');
        return;
      }

      // Skip supervisor decision if we're in the middle of tool calling sequence or exceeded maxResponseInRow (for automatic triggers only)
      if (shouldAvoidSupervisorDecision(messages, groupConfig?.maxResponseInRow, isManualTrigger)) {
        const reason = isManualTrigger
          ? 'waiting for tool calling sequence to complete'
          : 'waiting for tool calling sequence to complete or max responses exceeded';
        console.log(`Skipping supervisor decision - ${reason}`);
        return;
      }

      if (
        isClientDurableConversationGenerationEnabled() &&
        groupConfig.orchestratorModel &&
        groupConfig.orchestratorProvider
      ) {
        const supervisorIdempotencyKey = conversationGenerationRequestKey(
          'group-supervisor',
          nanoid(),
          groupId,
          currentTopicId,
        );
        const supervisorLaneKey = laneScopedClearKey(
          requestedSessionId,
          currentTopicId ?? null,
          null,
        );
        set(
          (state) =>
            trackDurableEnqueue(state, supervisorLaneKey, {
              idempotencyKey: supervisorIdempotencyKey,
              kind: 'group_supervisor',
            }),
          false,
          n('supervisor/trackDurableEnqueue'),
        );
        let enqueueResult: Awaited<ReturnType<typeof tryEnqueueConversationGeneration>> | undefined;
        try {
          enqueueResult = await tryEnqueueConversationGeneration({
            config: {
              locale: globalHelpers.getCurrentLanguage(),
              model: groupConfig.orchestratorModel,
              provider: groupConfig.orchestratorProvider,
            },
            conversationVersion: resolvedConversationVersion,
            expectedConversationVersion: resolvedConversationVersion,
            groupId,
            idempotencyKey: supervisorIdempotencyKey,
            kind: 'group_supervisor',
            replaceActive: true,
            sessionId: requestedSessionId,
            topicId: currentTopicId ?? undefined,
          });
        } finally {
          set(
            (state) => untrackDurableEnqueue(state, supervisorLaneKey, supervisorIdempotencyKey),
            false,
            n('supervisor/untrackDurableEnqueue'),
          );
        }
        const operation = asConversationGenerationOperation(enqueueResult);
        if (!isCurrentConversation()) {
          // A destructive action (e.g. topic delete) landed while the enqueue
          // was in flight: cancel the orphaned operation instead of attaching.
          if (operation) {
            await conversationGenerationService.cancel(operation.id).catch(() => undefined);
            return;
          }
          if (!isConversationGenerationDeferred(enqueueResult)) return;
        }
        if (operation) {
          get().attachConversationGeneration({
            clearGeneration: requestedClearFence,
            generation: get().conversationNavigationGeneration,
            groupId,
            kind: operation.kind,
            lane: operation.lane,
            laneGeneration: operation.laneGeneration,
            operationId: operation.id,
            revision: operation.revision,
            sessionId: requestedSessionId,
            threadId: operation.threadId || undefined,
            topicId: currentTopicId ?? undefined,
            userScope: accountMutationSnapshot.scope,
          });
          internal_toggleSupervisorLoading(true, groupId);
          return;
        }
      }

      // Create AbortController for this supervisor decision
      const abortController = new AbortController();

      // Store the AbortController in state
      set(
        produce((state: ChatStoreState) => {
          state.supervisorDecisionAbortControllers[groupId] = abortController;
        }),
        false,
        n(`setSupervisorAbortController/${groupId}`),
      );

      // Get real user name from user store
      const userStoreState = getUserStoreState();
      const realUserName = userProfileSelectors.nickName(userStoreState) || 'User';

      try {
        const todoKey = messageMapKey(groupId, currentTopicId);
        const contextExportRequest = contextExportCaptureId
          ? get().createContextExportRequest(contextExportCaptureId, 'supervisor')
          : undefined;

        const context: SupervisorContext = {
          allowDM: groupConfig.allowDM,
          availableAgents: agents!,
          contextExportRequest,
          groupId,
          messages,
          model: groupConfig.orchestratorModel,
          onContextSnapshot: (snapshot) => {
            if (!isCurrentConversation()) return;
            get().appendContextExportSnapshot(snapshot);
          },
          provider: groupConfig.orchestratorProvider,
          scene: groupConfig.scene,
          userName: realUserName,
          systemPrompt: groupConfig.systemPrompt,
          abortController,
          todoList: supervisorTodos?.[todoKey] || [],
        };

        internal_toggleSupervisorLoading(true, groupId);

        const { decisions, todos, todoUpdated } = await supervisor.makeDecision(context);
        if (!isCurrentConversation()) return;

        // Turn off supervisor thinking immediately after decision is made
        internal_toggleSupervisorLoading(false, groupId);

        get().internal_updateSupervisorTodos(groupId, currentTopicId, todos);

        if (todoUpdated) {
          await createSupervisorTodoMessage(todos);
          if (!isCurrentConversation()) return;
        }

        console.log('Supervisor decisions:', decisions);

        if (decisions.length > 0) {
          await get().internal_executeAgentResponses(
            groupId,
            decisions,
            resolvedConversationVersion,
            contextExportCaptureId,
          );
        }
      } catch (error) {
        if (!isCurrentConversation()) return;

        // Turn off supervisor thinking on error
        internal_toggleSupervisorLoading(false, groupId);

        if (
          (error instanceof Error && error.name === 'AbortError') ||
          (error instanceof Error && error.message.includes('The operation was aborted'))
        ) {
          console.log('Supervisor decision was aborted for group:', groupId);
          // Don't create error message for intentional aborts
        } else {
          console.error('Supervisor decision failed:', error);
          // Create supervisor error message to show the error to users
          await get().internal_createSupervisorErrorMessage(
            groupId,
            'Supervisor Decision Failed, Please check your configuration',
          );
        }
      } finally {
        if (isCurrentConversation()) {
          set(
            produce((state: ChatStoreState) => {
              if (state.supervisorDecisionAbortControllers[groupId] === abortController) {
                delete state.supervisorDecisionAbortControllers[groupId];
              }
            }),
            false,
            n(`cleanupSupervisorAbortController/${groupId}`),
          );
        }
      }
    },

    internal_executeAgentResponses: async (
      groupId: string,
      decisions: SupervisorDecisionList,
      expectedConversationVersion?: number,
      contextExportCaptureId?: string,
    ) => {
      const accountMutationSnapshot = captureAccountMutationSnapshot(getUserStoreState());
      if (!accountMutationSnapshot) return;

      const conversationClearGeneration = get().conversationClearGeneration;
      const requestedSessionId = useSessionStore.getState().activeId;
      const requestedTopicId = get().activeTopicId;
      const isCurrentConversation = () =>
        isAccountMutationCurrent(getUserStoreState(), accountMutationSnapshot) &&
        get().conversationClearGeneration === conversationClearGeneration &&
        useSessionStore.getState().activeId === requestedSessionId &&
        get().activeTopicId === requestedTopicId;
      const resolvedConversationVersion =
        expectedConversationVersion ?? (await messageService.getConversationVersion());
      if (!isCurrentConversation()) return;
      log('Executing agent responses with decisions:', decisions);
      const { internal_processAgentMessage, internal_triggerSupervisorDecisionDebounced } = get();

      // Read the target group's config to respect per-group settings
      const groupConfig = selectGroupConfig(groupId);
      const agents = sessionSelectors.currentGroupAgents(useSessionStore.getState());

      // Sort decisions by member order if response order is sequential
      const sortedDecisions =
        groupConfig?.responseOrder === 'sequential'
          ? [...decisions].sort((a, b) => {
              const agentA = agents?.find((agent) => agent.id === a.id);
              const agentB = agents?.find((agent) => agent.id === b.id);

              // Default to order 0 if not found or not set
              const orderA = agentA?.order ?? 0;
              const orderB = agentB?.order ?? 0;

              return orderA - orderB;
            })
          : decisions;

      try {
        if (groupConfig?.responseOrder === 'sequential') {
          // Process agents sequentially with delay
          for (const [index, decision] of sortedDecisions.entries()) {
            if (!isCurrentConversation()) return;

            // Add delay between agents (except for the first one)
            if (index > 0) {
              await new Promise((resolve) => {
                setTimeout(resolve, SEQUENTIAL_RESPONSE_DELAY);
              });
              if (!isCurrentConversation()) return;
            }

            const operationId = await internal_processAgentMessage(
              groupId,
              decision.id,
              decision.target,
              decision.instruction,
              resolvedConversationVersion,
              contextExportCaptureId,
            );
            if (!isCurrentConversation()) return;
            if (operationId) await waitForConversationGeneration(operationId);
          }
        } else {
          // Process agents in parallel for natural response order
          const operationIds = await Promise.all(
            sortedDecisions.map((decision) =>
              internal_processAgentMessage(
                groupId,
                decision.id,
                decision.target,
                decision.instruction,
                resolvedConversationVersion,
                contextExportCaptureId,
              ),
            ),
          );
          if (!isCurrentConversation()) return;
          await Promise.all(
            operationIds
              .filter(Boolean)
              .map((operationId) => waitForConversationGeneration(operationId)),
          );
          if (!isCurrentConversation()) return;
        }

        // Only trigger next supervisor decision after ALL agents have completed their responses
        // This prevents rapid-fire agent responses and gives time for conversation to settle
        if (sortedDecisions.length > 0) {
          internal_triggerSupervisorDecisionDebounced(groupId, resolvedConversationVersion);
        }
      } catch (error) {
        if (!isCurrentConversation()) return;

        console.error('Failed to execute agent responses:', error);
        // Create supervisor error message to show the error to users
        await get().internal_createSupervisorErrorMessage(
          groupId,
          error instanceof Error ? error : new Error(String(error)),
          'Agent Response Execution Failed',
        );
      }
    },

    // For group member responsing
    internal_processAgentMessage: async (
      groupId: string,
      agentId: string,
      targetId?: string,
      instruction?: string,
      expectedConversationVersion?: number,
      contextExportCaptureId?: string,
      isToolContinuation = false,
    ) => {
      const accountMutationSnapshot = captureAccountMutationSnapshot(getUserStoreState());
      if (!accountMutationSnapshot) return;

      const conversationClearGeneration = get().conversationClearGeneration;
      const requestedSessionId = useSessionStore.getState().activeId;
      const requestedTopicId = get().activeTopicId;
      // Full clear fence (global + topic tombstone): topic deletion never bumps
      // the global epoch, so only the resolved fence detects it before the
      // in-flight key is registered or a returned operation is attached.
      const requestedClearFence = resolveConversationClearGeneration(
        get(),
        requestedSessionId,
        requestedTopicId ?? null,
        null,
        'group_agent',
      );
      const isCurrentConversation = () =>
        isAccountMutationCurrent(getUserStoreState(), accountMutationSnapshot) &&
        get().conversationClearGeneration === conversationClearGeneration &&
        useSessionStore.getState().activeId === requestedSessionId &&
        get().activeTopicId === requestedTopicId &&
        isConversationClearFenceCurrent(
          get(),
          requestedClearFence,
          requestedSessionId,
          requestedTopicId ?? null,
          null,
          'group_agent',
        );
      const resolvedConversationVersion =
        expectedConversationVersion ?? (await messageService.getConversationVersion());
      if (!isCurrentConversation()) return;
      log('internal_processAgentMessage called with:', {
        groupId,
        agentId,
        targetId,
        instruction,
      });
      const {
        messagesMap,
        internal_createMessage,
        internal_fetchAIChatMessage,
        refreshMessages,
        activeTopicId,
        internal_dispatchMessage,
        internal_toggleChatLoading,
        triggerToolCalls,
      } = get();

      try {
        if (!isCurrentConversation()) return;

        const allMessages = messagesMap[messageMapKey(groupId, activeTopicId)] || [];
        if (allMessages.length === 0) return;

        // Filter messages for this specific agent based on DM targeting rules
        const messages = filterMessagesForAgent(allMessages, agentId);

        // Get group agents and find the specific agent
        const agents = sessionSelectors.currentGroupAgents(useSessionStore.getState());
        const agentData = agents?.find((agent) => agent.id === agentId);

        if (!agentData) {
          console.error(`Agent ${agentId} not found in group members`);
          return;
        }

        const agentProvider = agentData.provider || undefined;
        const agentModel = agentData.model || undefined;

        log('Group chat agent data:', agentData);

        if (!agentProvider || !agentModel) {
          console.error(`No provider or model configured for agent ${agentId}`);
          return;
        }

        // Get the individual agent's full configuration.
        // const agentStoreState = getAgentStoreState();
        // const agentConfig = agentSelectors.getAgentConfigById(agentId)(agentStoreState);

        // Get real user name from user store
        const userStoreState = getUserStoreState();
        const realUserName = userProfileSelectors.nickName(userStoreState) || 'User';

        const agentTitleMap: GroupMemberInfo[] = [
          { id: 'user', title: realUserName },
          ...(agents || []).map((agent) => ({ id: agent.id || '', title: agent.title || '' })),
        ];

        const generalInstruction = userGeneralSettingsSelectors.generalInstruction(userStoreState);
        const baseSystemRole = composeSystemRole(
          generalInstruction,
          agentData.systemRole || undefined,
        );
        const members: GroupMemberInfo[] = agentTitleMap as GroupMemberInfo[];
        const groupChatSystemPrompt = buildGroupChatSystemPrompt({
          groupMembers: members,
          baseSystemRole,
          agentId,
          messages,
          targetId,
          instruction,
        });

        // Create agent message using real agent config
        const agentMessage: CreateMessageParams = {
          role: 'assistant',
          fromModel: agentModel,
          groupId,
          content: LOADING_FLAT,
          fromProvider: agentProvider,
          agentId,
          sessionId: useSessionStore.getState().activeId,
          topicId: activeTopicId,
          targetId: targetId, // Use targetId when provided for DM messages
        };

        log('Creating agent message with:', agentMessage);

        const assistantId = await internal_createMessage(agentMessage, {
          expectedConversationVersion: resolvedConversationVersion,
        });
        if (!isCurrentConversation()) return;

        if (assistantId && isClientDurableConversationGenerationEnabled()) {
          const agentIdempotencyKey = conversationGenerationIdempotencyKey(
            'group-agent',
            assistantId,
          );
          const agentLaneKey = laneScopedClearKey(requestedSessionId, activeTopicId ?? null, null);
          set(
            (state) =>
              trackDurableEnqueue(state, agentLaneKey, {
                idempotencyKey: agentIdempotencyKey,
                kind: 'group_agent',
              }),
            false,
            n('groupAgent/trackDurableEnqueue'),
          );
          let enqueueResult:
            Awaited<ReturnType<typeof tryEnqueueConversationGeneration>> | undefined;
          const debugSpanId = createGenerationDebugSpanId();
          try {
            enqueueResult = await tryEnqueueConversationGeneration({
              agentId,
              assistantMessageId: assistantId,
              config: {
                ...buildDurableConversationConfig({
                  agentConfig: {
                    chatConfig: agentData.chatConfig,
                    model: agentModel,
                    params: agentData.params as Record<string, unknown> | undefined,
                    plugins: agentData.plugins,
                    provider: agentProvider,
                    systemRole: groupChatSystemPrompt,
                  },
                  chatConfig: agentData.chatConfig || undefined,
                  enableMemoryTool: false,
                  locale: globalHelpers.getCurrentLanguage(),
                  systemRole: groupChatSystemPrompt,
                }),
                groupId,
                targetId,
              },
              conversationVersion: resolvedConversationVersion,
              expectedConversationVersion: resolvedConversationVersion,
              groupId,
              debugSpanId,
              idempotencyKey: agentIdempotencyKey,
              kind: 'group_agent',
              replaceActive: true,
              sessionId: requestedSessionId,
              topicId: activeTopicId,
            });
          } finally {
            set(
              (state) => untrackDurableEnqueue(state, agentLaneKey, agentIdempotencyKey),
              false,
              n('groupAgent/untrackDurableEnqueue'),
            );
          }
          const operation = asConversationGenerationOperation(enqueueResult);
          if (!isCurrentConversation()) {
            // A destructive action (e.g. topic delete) landed while the enqueue
            // was in flight: cancel the orphaned operation instead of attaching.
            if (operation) {
              await conversationGenerationService.cancel(operation.id).catch(() => undefined);
              return;
            }
            if (!isConversationGenerationDeferred(enqueueResult)) return;
          }
          if (isConversationGenerationDeferred(enqueueResult) && assistantId) {
            get().internal_markDurableLaneDeferred({
              assistantMessageId: assistantId,
              reason: enqueueResult.reason,
              sessionId: requestedSessionId,
              spanId: debugSpanId,
              threadId: null,
              toolName: enqueueResult.toolName,
              topicId: activeTopicId,
            });
          }
          if (operation) {
            get().attachConversationGeneration({
              assistantMessageId: assistantId,
              clearGeneration: requestedClearFence,
              generation: get().conversationNavigationGeneration,
              groupId,
              kind: operation.kind,
              lane: operation.lane,
              laneGeneration: operation.laneGeneration,
              operationId: operation.id,
              revision: operation.revision,
              sessionId: requestedSessionId,
              threadId: operation.threadId || undefined,
              topicId: activeTopicId,
              userScope: accountMutationSnapshot.scope,
            });
            return operation.id;
          }
        }

        const systemMessage: UIChatMessage = {
          id: 'group-system',
          role: 'system',
          content: groupChatSystemPrompt,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          meta: {},
        };

        // Add author names to messages for better context
        const messagesWithAuthors = messages.map((msg) => {
          const authorInfo = agentTitleMap.find((member) =>
            msg.role === 'user' ? member.id === 'user' : member.id === msg.agentId,
          );
          const authorName = authorInfo?.title || (msg.role === 'user' ? realUserName : 'Unknown');
          const authorId = msg.role === 'user' ? 'user' : msg.agentId || 'unknown';

          // Keep user message as-is
          if (msg.role === 'user') {
            return {
              ...msg,
              content: msg.content,
            };
          }

          return {
            ...msg,
            content: `<author_name_do_not_include_in_your_response name="${authorName}" id="${authorId}" />${msg.content}`,
          };
        });

        // TODO: Use context engineering
        const messagesForAPI = [systemMessage, ...messagesWithAuthors];

        if (assistantId) {
          const { isFunctionCall, persistenceAmbiguous, persistenceFailure } =
            await internal_fetchAIChatMessage({
              conversationContext: {
                clearGeneration: requestedClearFence,
                generation: get().conversationNavigationGeneration,
                sessionId: requestedSessionId,
                threadId: null,
                topicId: activeTopicId,
              },
              messages: messagesForAPI,
              messageId: assistantId,
              model: agentModel,
              provider: agentProvider,
              params: {
                contextExportCaptureId,
                isToolContinuation,
                traceId: `group-${groupId}-agent-${agentId}`,
                agentConfig: agentData,
              },
            });
          if (!isCurrentConversation()) return;

          // Handle tool calling in group chat like single chat
          if (isFunctionCall) {
            if (persistenceAmbiguous) {
              await notifyToolCallPersistenceFailure(persistenceFailure);
              return;
            }

            get().internal_toggleMessageInToolsCalling(true, assistantId);
            await refreshMessages();
            if (!isCurrentConversation()) return;

            await triggerToolCalls(assistantId, {
              contextExportCaptureId,
              expectedConversationVersion: resolvedConversationVersion,
              threadId: undefined,
              inPortalThread: false,
            });
            if (!isCurrentConversation()) return;

            // Change: if an agent message is a tool call, make the same agent speak again
            // instead of asking supervisor for a decision.
            await get().internal_processAgentMessage(
              groupId,
              agentId,
              targetId,
              instruction,
              resolvedConversationVersion,
              contextExportCaptureId,
              true,
            );
            return;
          }
        }

        await refreshMessages();
        if (!isCurrentConversation()) return;

        // Don't trigger supervisor decision after individual agent responses
        // This prevents infinite loops of agent responses
        // Supervisor decisions should only be triggered after user messages or when all agents complete
      } catch (error) {
        if (!isCurrentConversation()) return;

        console.error('Failed to process message for agent:', agentId, error);

        // Create supervisor error message to show the error to users
        await get().internal_createSupervisorErrorMessage(
          groupId,
          error instanceof Error ? error : new Error(String(error)),
          `Agent ${agentId} Response Failed`,
        );

        // Also update error state if we have an assistant message (for consistency with single chat)
        const currentMessages = get().messagesMap[messageMapKey(groupId, activeTopicId)] || [];
        const errorMessage = currentMessages.find(
          (m) => m.role === 'assistant' && m.agentId === agentId && m.content === LOADING_FLAT,
        );

        if (errorMessage) {
          internal_dispatchMessage({
            id: errorMessage.id,
            type: 'updateMessage',
            value: {
              content: `Error: Failed to generate response. ${error instanceof Error ? error.message : 'Unknown error'}`,
              error: {
                type: ChatErrorType.CreateMessageError,
                message: error instanceof Error ? error.message : 'Unknown error',
              },
            },
          });
        }
      } finally {
        if (isCurrentConversation()) {
          internal_toggleChatLoading(false, undefined, n('processAgentMessage(end)'));
        }
      }
    },

    internal_setActiveGroup: () => {
      // Update the active session type to 'group' when setting an active group
      get().internal_updateActiveSessionType('group');
    },

    internal_toggleSupervisorLoading: (loading: boolean, groupId?: string) => {
      set(
        {
          supervisorDecisionLoading: groupId
            ? toggleBooleanList(get().supervisorDecisionLoading, groupId, loading)
            : loading
              ? get().supervisorDecisionLoading
              : [],
        },
        false,
        n(`toggleSupervisorLoading/${loading ? 'start' : 'end'}`),
      );
    },

    internal_triggerSupervisorDecisionDebounced: (
      groupId: string,
      expectedConversationVersion?: number,
      contextExportCaptureId?: string,
    ) => {
      const accountMutationSnapshot = captureAccountMutationSnapshot(getUserStoreState());
      if (!accountMutationSnapshot) return;

      const { internal_cancelSupervisorDecision, internal_triggerSupervisorDecision } = get();
      const inheritedContextExportCaptureId = pendingSupervisorCaptureIds.get(groupId);
      const activeContextExportCaptureId =
        contextExportCaptureId ?? inheritedContextExportCaptureId;

      internal_cancelSupervisorDecision(groupId, !!inheritedContextExportCaptureId);

      // Use per-group config for debounce calculation
      const groupConfig = selectGroupConfig(groupId);
      const responseSpeed = groupConfig?.responseSpeed;
      const debounceThreshold = getDebounceThreshold(responseSpeed);

      console.log(
        `Using debounce threshold: ${debounceThreshold}ms for responseSpeed: ${responseSpeed}`,
      );

      // Capture topicId at schedule time to decouple from future topic switches
      const scheduledTopicId = get().activeTopicId;
      const scheduledConversationClearGeneration = get().conversationClearGeneration;
      const scheduledSessionId = useSessionStore.getState().activeId;
      const isCurrentConversation = () =>
        isAccountMutationCurrent(getUserStoreState(), accountMutationSnapshot) &&
        get().conversationClearGeneration === scheduledConversationClearGeneration &&
        useSessionStore.getState().activeId === scheduledSessionId &&
        get().activeTopicId === scheduledTopicId;

      // Set a new timer with dynamic debounce based on group settings
      const timerId = setTimeout(async () => {
        if (!isCurrentConversation()) {
          pendingSupervisorCaptureIds.delete(groupId);
          return;
        }

        console.log(`Debounced supervisor decision triggered for group ${groupId}`);

        // Clean up the timer from state before executing
        set(
          produce((state: ChatStoreState) => {
            delete state.supervisorDebounceTimers[groupId];
          }),
          false,
          n(`cleanupSupervisorTimer/${groupId}`),
        );
        pendingSupervisorCaptureIds.delete(groupId);

        try {
          await internal_triggerSupervisorDecision(
            groupId,
            scheduledTopicId,
            false,
            expectedConversationVersion,
            activeContextExportCaptureId,
          );
        } catch (error) {
          console.error('Failed to execute supervisor decision for group:', groupId, error);
        } finally {
          if (activeContextExportCaptureId && isCurrentConversation()) {
            get().completeContextExport(activeContextExportCaptureId);
          }
        }
      }, debounceThreshold);

      // Store the timer in state
      if (activeContextExportCaptureId) {
        pendingSupervisorCaptureIds.set(groupId, activeContextExportCaptureId);
      }
      set(
        produce((state: ChatStoreState) => {
          state.supervisorDebounceTimers[groupId] = timerId as any;
        }),
        false,
        n(`setSupervisorTimer/${groupId}`),
      );
    },

    internal_cancelSupervisorDecision: (groupId: string, preservePendingCapture = false) => {
      const {
        supervisorDebounceTimers,
        supervisorDecisionAbortControllers,
        internal_toggleSupervisorLoading,
      } = get();
      const existingTimer = supervisorDebounceTimers[groupId];
      const existingAbortController = supervisorDecisionAbortControllers[groupId];

      // Cancel pending debounced timer
      if (existingTimer) {
        clearTimeout(existingTimer);
        const pendingCaptureId = pendingSupervisorCaptureIds.get(groupId);
        pendingSupervisorCaptureIds.delete(groupId);
        if (pendingCaptureId && !preservePendingCapture) {
          get().completeContextExport(pendingCaptureId);
        }
        console.log(`Cancelled pending supervisor decision timer for group ${groupId}`);

        // Remove timer from state
        set(
          produce((state: ChatStoreState) => {
            delete state.supervisorDebounceTimers[groupId];
          }),
          false,
          n(`cancelSupervisorTimer/${groupId}`),
        );
      }

      // Abort ongoing supervisor decision request
      if (existingAbortController) {
        existingAbortController.abort('User cancelled supervisor decision');
        console.log(`Aborted ongoing supervisor decision request for group ${groupId}`);

        // Remove abort controller from state
        set(
          produce((state: ChatStoreState) => {
            delete state.supervisorDecisionAbortControllers[groupId];
          }),
          false,
          n(`cancelSupervisorAbortController/${groupId}`),
        );
      }

      // Stop the loading state
      internal_toggleSupervisorLoading(false, groupId);
      console.log(`Stopped supervisor loading state for group ${groupId}`);
    },

    internal_cancelAllSupervisorDecisions: () => {
      const { supervisorDebounceTimers, supervisorDecisionAbortControllers } = get();
      const timerGroupIds = Object.keys(supervisorDebounceTimers);
      const abortControllerGroupIds = Object.keys(supervisorDecisionAbortControllers);

      if (timerGroupIds.length > 0 || abortControllerGroupIds.length > 0) {
        console.log('Cancelling all pending supervisor decisions for session change/cleanup');

        // Cancel all timers
        timerGroupIds.forEach((groupId) => {
          const timer = supervisorDebounceTimers[groupId];
          if (timer) {
            clearTimeout(timer);
          }
          const pendingCaptureId = pendingSupervisorCaptureIds.get(groupId);
          pendingSupervisorCaptureIds.delete(groupId);
          if (pendingCaptureId) get().completeContextExport(pendingCaptureId);
        });

        // Abort all ongoing requests
        abortControllerGroupIds.forEach((groupId) => {
          const abortController = supervisorDecisionAbortControllers[groupId];
          if (abortController) {
            abortController.abort('Session cleanup');
          }
        });

        // Clear all timers and abort controllers from state
        set(
          {
            supervisorDebounceTimers: {},
            supervisorDecisionAbortControllers: {},
          },
          false,
          n('cancelAllSupervisorDecisions'),
        );
      }
    },

    internal_updateSupervisorTodos: (groupId, topicId, todos) => {
      if (!groupId) return;

      const key = messageMapKey(groupId, topicId);

      set(
        produce((state: ChatStoreState) => {
          state.supervisorTodos[key] = todos;
        }),
        false,
        n(`internal_updateSupervisorTodos/${groupId}`),
      );
    },

    internal_createSupervisorErrorMessage: async (groupId: string, error: Error | string) => {
      const accountMutationSnapshot = captureAccountMutationSnapshot(getUserStoreState());
      if (!accountMutationSnapshot) return;

      const { internal_createTmpMessage, activeTopicId } = get();

      try {
        const errorMessage = error instanceof Error ? error.message : error;
        const groupConfig = selectGroupConfig(groupId);

        const supervisorMessage: CreateMessageParams = {
          role: 'supervisor',
          fromModel: groupConfig.orchestratorModel,
          fromProvider: groupConfig.orchestratorProvider,
          groupId,
          sessionId: useSessionStore.getState().activeId || groupId,
          topicId: activeTopicId,
          error: {
            type: ChatErrorType.SupervisorDecisionFailed,
            message: errorMessage,
          },
          content: LOADING_FLAT,
        };

        // Create a temporary message that only exists in UI state, no API call
        internal_createTmpMessage(supervisorMessage);
      } catch (createError) {
        console.error('Failed to create supervisor error message:', createError);
      }
    },
  };
};
