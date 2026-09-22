import { UIChatMessage } from '@lobechat/types';
import { LobeAgentConfig } from '@lobechat/types';
import { act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_INBOX_AVATAR } from '@/const/meta';
import { INBOX_SESSION_ID } from '@/const/session';
import { useAgentStore } from '@/store/agent';
import { ChatStore } from '@/store/chat';
import { initialState } from '@/store/chat/initialState';
import { messageMapKey } from '@/store/chat/utils/messageMapKey';
import { createServerConfigStore } from '@/store/serverConfig/store';
import { userProfileSelectors } from '@/store/user/selectors';
import { merge } from '@/utils/merge';

import { chatSelectors } from './selectors';

vi.mock('i18next', () => ({
  t: vi.fn((key) => key), // Simplified mock return value
}));

const initialStore = initialState as ChatStore;

const mockMessages = [
  {
    id: 'msg1',
    content: 'Hello World',
    role: 'user',
  },
  {
    id: 'msg2',
    content: 'Goodbye World',
    role: 'user',
  },
  {
    id: 'msg3',
    content: 'Function Message',
    role: 'tool',
    tools: [
      {
        arguments: ['arg1', 'arg2'],
        identifier: 'func1',
        apiName: 'ttt',
        type: 'pluginType',
        id: 'abc',
      },
    ],
  },
] as UIChatMessage[];

const mockReasoningMessages = [
  {
    id: 'msg1',
    content: 'Hello World',
    role: 'user',
  },
  {
    id: 'msg2',
    content: 'Goodbye World',
    role: 'user',
  },
  {
    id: 'msg3',
    content: 'Content Message',
    role: 'assistant',
    reasoning: {
      content: 'Reasoning Content',
    },
  },
] as UIChatMessage[];

const mockedChats = [
  {
    id: 'msg1',
    content: 'Hello World',
    role: 'user',
    meta: {
      avatar: '😀',
    },
  },
  {
    id: 'msg2',
    content: 'Goodbye World',
    role: 'user',
    meta: {
      avatar: '😀',
    },
  },
  {
    id: 'msg3',
    content: 'Function Message',
    role: 'tool',
    meta: {
      avatar: DEFAULT_INBOX_AVATAR,
      backgroundColor: 'rgba(0,0,0,0)',
      description: 'inbox.desc',
      title: 'inbox.title',
    },
    tools: [
      {
        arguments: ['arg1', 'arg2'],
        identifier: 'func1',
        apiName: 'ttt',
        type: 'pluginType',
        id: 'abc',
      },
    ],
  },
] as UIChatMessage[];

const mockChatStore = {
  messagesMap: {
    [messageMapKey('abc')]: mockMessages,
  },
  activeId: 'abc',
} as ChatStore;

beforeAll(() => {
  createServerConfigStore();
});

afterEach(() => {
  const store = createServerConfigStore();
  store.setState((state) => ({
    featureFlags: { ...state.featureFlags, isAgentEditable: true },
  }));
});

describe('chatSelectors', () => {
  describe('getMessageById', () => {
    it('should return undefined if the message with the given id does not exist', () => {
      const message = chatSelectors.getMessageById('non-existent-id')(initialStore);
      expect(message).toBeUndefined();
    });

    it('should return the message object with the matching id', () => {
      const state = merge(initialStore, {
        messagesMap: {
          [messageMapKey('abc')]: mockMessages,
        },
        activeId: 'abc',
      });
      const message = chatSelectors.getMessageById('msg1')(state);
      expect(message).toEqual(mockedChats[0]);
    });

    it('should return the message with the matching id', () => {
      const message = chatSelectors.getMessageById('msg1')(mockChatStore);
      expect(message).toEqual(mockedChats[0]);
    });

    it('should return undefined if no message matches the id', () => {
      const message = chatSelectors.getMessageById('nonexistent')(mockChatStore);
      expect(message).toBeUndefined();
    });

    it('returns the store message object without cloning the topic', () => {
      const found = chatSelectors.getRawMessageById('msg1')(mockChatStore);
      expect(found).toBe(mockMessages[0]);
    });
  });

  describe('getMessageByToolCallId', () => {
    it('should return undefined if the message with the given id does not exist', () => {
      const message = chatSelectors.getMessageByToolCallId('non-existent-id')(initialStore);
      expect(message).toBeUndefined();
    });

    it('should return the message object with the matching tool_call_id', () => {
      const toolMessage = {
        id: 'msg3',
        content: 'Function Message',
        role: 'tool',
        tool_call_id: 'ttt',
        plugin: {
          arguments: 'arg1',
          identifier: 'func1',
          apiName: 'ttt',
          type: 'default',
        },
      } as UIChatMessage;
      const state = merge(initialStore, {
        messagesMap: {
          [messageMapKey('abc')]: [...mockMessages, toolMessage],
        },
        activeId: 'abc',
      });
      const message = chatSelectors.getMessageByToolCallId('ttt')(state);
      expect(message).toMatchObject(toolMessage);
    });
  });

  describe('currentChatsWithHistoryConfig', () => {
    it('should slice the messages according to the current agent config', () => {
      const state = merge(initialStore, {
        messagesMap: {
          [messageMapKey('abc')]: mockMessages,
        },
        activeId: 'abc',
      });

      const chats = chatSelectors.mainAIChatsWithHistoryConfig(state);
      expect(chats).toHaveLength(3);
      expect(chats).toEqual(mockedChats);
    });
    it('should slice the messages according to config, assuming historyCount is mocked to 2', async () => {
      const state = merge(initialStore, {
        messagesMap: {
          [messageMapKey('abc')]: mockMessages,
        },
        activeId: 'abc',
      });
      act(() => {
        useAgentStore.setState({
          activeId: 'inbox',
          agentMap: {
            inbox: {
              chatConfig: {
                historyCount: 2,
                enableHistoryCount: true,
              },
              model: 'abc',
            } as LobeAgentConfig,
          },
        });
      });

      const chats = chatSelectors.mainAIChatsWithHistoryConfig(state);

      expect(chats).toHaveLength(3);
      expect(chats).toEqual(mockedChats);
    });

    it('should apply the summary cursor when history compression is enabled', () => {
      const topicId = 'topic-with-summary';
      const state = merge(initialStore, {
        activeId: 'abc',
        activeTopicId: topicId,
        messagesMap: { [messageMapKey('abc', topicId)]: mockMessages },
        topicMaps: {
          abc: [{ id: topicId, metadata: { historySummaryLastMessageId: 'msg1' } }],
        },
      });
      useAgentStore.setState({
        activeId: 'inbox',
        agentMap: {
          inbox: {
            chatConfig: {
              enableCompressHistory: true,
              enableHistoryCount: true,
              historyCount: 3,
            },
            model: 'abc',
          } as LobeAgentConfig,
        },
      });

      expect(chatSelectors.mainAIChatsWithHistoryConfig(state).map(({ id }) => id)).toEqual([
        'msg2',
        'msg3',
      ]);
    });

    it('should ignore the summary cursor when history compression is disabled', () => {
      const topicId = 'topic-with-disabled-summary';
      const state = merge(initialStore, {
        activeId: 'abc',
        activeTopicId: topicId,
        messagesMap: { [messageMapKey('abc', topicId)]: mockMessages },
        topicMaps: {
          abc: [{ id: topicId, metadata: { historySummaryLastMessageId: 'msg1' } }],
        },
      });
      useAgentStore.setState({
        activeId: 'inbox',
        agentMap: {
          inbox: {
            chatConfig: {
              enableCompressHistory: false,
              enableHistoryCount: true,
              historyCount: 3,
            },
            model: 'abc',
          } as LobeAgentConfig,
        },
      });

      expect(chatSelectors.mainAIChatsWithHistoryConfig(state).map(({ id }) => id)).toEqual([
        'msg1',
        'msg2',
        'msg3',
      ]);
    });
  });

  describe('mainDisplayChats', () => {
    it('should return existing messages except tool message', () => {
      const state = merge(initialStore, {
        messagesMap: {
          [messageMapKey('someActiveId')]: mockMessages,
        },
        activeId: 'someActiveId',
      });
      const chats = chatSelectors.mainDisplayChats(state);
      expect(chats).toEqual(mockedChats.slice(0, 2));
    });
  });

  describe('chatsMessageString', () => {
    it('should concatenate the contents of all messages returned by currentChatsWithHistoryConfig', () => {
      // Prepare a state with a few messages
      const state = merge(initialStore, {
        messagesMap: {
          [messageMapKey('active-session')]: mockMessages,
        },
        activeId: 'active-session',
      });

      // The configured window ends at the latest user; its tool continuation stays attached.
      const expectedString = mockMessages.map((m) => m.content).join('');

      // Call the selector and verify the result
      const concatenatedString = chatSelectors.mainAIChatsMessageString(state);
      expect(concatenatedString).toBe(expectedString);

      // Restore the mocks after the test
      vi.restoreAllMocks();
    });
  });

  describe('latestMessageReasoningContent', () => {
    it('should return the reasoning content of the latest message', () => {
      // Prepare a state with a few messages
      const state = merge(initialStore, {
        messagesMap: {
          [messageMapKey('active-session')]: mockReasoningMessages,
        },
        activeId: 'active-session',
      });

      const expectedString = mockReasoningMessages.at(-1)?.reasoning?.content;

      // Call the selector and verify the result
      const reasoningContent = chatSelectors.mainAILatestMessageReasoningContent(state);
      expect(reasoningContent).toBe(expectedString);

      // Restore the mocks after the test
      vi.restoreAllMocks();
    });
  });

  describe('mainAIFollowOutputRevision', () => {
    it('does not join message bodies', () => {
      const huge = 'x'.repeat(20_000);
      const state = merge(initialStore, {
        messagesMap: {
          [messageMapKey('active-session')]: [{ content: huge, id: 'msg1', role: 'user' }],
        },
        activeId: 'active-session',
      });

      const revision = chatSelectors.mainAIFollowOutputRevision(state);
      expect(revision.includes(huge)).toBe(false);
      expect(revision).toContain('20000');
    });

    it('changes when last-message reasoning length grows', () => {
      const before = merge(initialStore, {
        messagesMap: {
          [messageMapKey('active-session')]: mockReasoningMessages,
        },
        activeId: 'active-session',
      });
      const after = merge(initialStore, {
        messagesMap: {
          [messageMapKey('active-session')]: [
            ...mockReasoningMessages.slice(0, 2),
            {
              ...mockReasoningMessages[2],
              reasoning: { content: 'Reasoning Content grown' },
            },
          ],
        },
        activeId: 'active-session',
      });

      expect(chatSelectors.mainAIFollowOutputRevision(before)).not.toBe(
        chatSelectors.mainAIFollowOutputRevision(after),
      );
    });
  });

  describe('isAIGenerating', () => {
    it('is true when a displayed row is in chatLoadingIds', () => {
      const state = merge(initialStore, {
        activeId: 'active-session',
        chatLoadingIds: ['msg1'],
        messagesMap: {
          [messageMapKey('active-session')]: mockMessages,
        },
      });

      expect(chatSelectors.isAIGenerating(state)).toBe(true);
    });

    it('ignores tool-only loading ids', () => {
      const state = merge(initialStore, {
        activeId: 'active-session',
        chatLoadingIds: ['msg3'],
        messagesMap: {
          [messageMapKey('active-session')]: mockMessages,
        },
      });

      expect(chatSelectors.isAIGenerating(state)).toBe(false);
    });

    it('does not clone display chats through getMeta', () => {
      const spy = vi.spyOn(userProfileSelectors, 'userAvatar');
      const state = merge(initialStore, {
        activeId: 'active-session',
        chatLoadingIds: ['msg1'],
        messagesMap: {
          [messageMapKey('active-session')]: mockMessages,
        },
      });

      expect(chatSelectors.isAIGenerating(state)).toBe(true);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe('isCurrentChatTurnBusy', () => {
    const activeId = 'active-session';
    const topicId = 'topic-1';
    const mapKey = messageMapKey(activeId, topicId);
    const messages = [
      { content: 'hi', id: 'user-1', role: 'user' },
      { content: 'working', id: 'assistant-1', role: 'assistant' },
      { content: '{}', id: 'tool-1', parentId: 'assistant-1', role: 'tool' },
    ] as UIChatMessage[];

    const base = {
      activeId,
      activeTopicId: topicId,
      messagesMap: {
        [mapKey]: messages,
      },
    };

    const durableOp = (
      kind: 'chat' | 'rag' | 'topic_title' | 'memory_compaction' | 'group_supervisor',
    ) =>
      merge(initialStore, {
        ...base,
        messagesMap: { [mapKey]: [] },
        serverGenerationOperations: {
          [mapKey]: {
            op1: {
              clearGeneration: 1,
              generation: 1,
              kind,
              lane: 'lane',
              operationId: 'op1',
              sessionId: activeId,
              topicId,
              userScope: 'user:a',
            },
          },
        },
      });

    it('is false when the turn is idle', () => {
      expect(chatSelectors.isCurrentChatTurnBusy(merge(initialStore, base))).toBe(false);
    });

    it('is true when a displayed assistant is in chatLoadingIds', () => {
      const state = merge(initialStore, { ...base, chatLoadingIds: ['assistant-1'] });

      expect(chatSelectors.isCurrentChatTurnBusy(state)).toBe(true);
    });

    it('ignores a tool-role chatLoadingIds entry', () => {
      const state = merge(initialStore, { ...base, chatLoadingIds: ['tool-1'] });

      expect(chatSelectors.isCurrentChatTurnBusy(state)).toBe(false);
    });

    it('stays busy for tool, RAG, reasoning, search, and plugin phases', () => {
      const phases = [
        { messageInToolsCallingIds: ['assistant-1'] },
        { messageRAGLoadingIds: ['user-1'] },
        { reasoningLoadingIds: ['assistant-1'] },
        { searchWorkflowLoadingIds: ['assistant-1'] },
        { pluginApiLoadingIds: ['tool-1'] },
        { toolCallingStreamIds: { 'assistant-1': [true] } },
      ];

      for (const phase of phases) {
        expect(
          chatSelectors.isCurrentChatTurnBusy(merge(initialStore, { ...base, ...phase })),
        ).toBe(true);
      }
    });

    it('stays busy for a deferred browser lane that still has a tool loop', () => {
      const state = merge(initialStore, {
        ...base,
        deferredBrowserGenerationLanes: {
          [`${mapKey}:main`]: {
            assistantMessageId: 'assistant-1',
            reason: 'unsupported_tool',
          },
        },
        messagesMap: {
          [mapKey]: [
            {
              content: 'calling',
              id: 'assistant-1',
              role: 'assistant',
              tools: [{ id: 'call-1' }],
            },
          ],
        },
      });

      expect(chatSelectors.isCurrentChatTurnBusy(state)).toBe(true);
    });

    it('stays busy for a chat-family or rag durable op before the row is displayed', () => {
      expect(chatSelectors.isCurrentChatTurnBusy(durableOp('chat'))).toBe(true);
      expect(chatSelectors.isCurrentChatTurnBusy(durableOp('rag'))).toBe(true);
    });

    it('ignores topic title, memory compaction, group supervisor, and topic CRUD', () => {
      expect(chatSelectors.isCurrentChatTurnBusy(durableOp('topic_title'))).toBe(false);
      expect(chatSelectors.isCurrentChatTurnBusy(durableOp('memory_compaction'))).toBe(false);
      expect(chatSelectors.isCurrentChatTurnBusy(durableOp('group_supervisor'))).toBe(false);
      expect(
        chatSelectors.isCurrentChatTurnBusy(
          merge(initialStore, { ...base, topicLoadingIds: [topicId] }),
        ),
      ).toBe(false);
    });

    it('stays busy during the send RPC and pre-send compaction', () => {
      expect(
        chatSelectors.isCurrentChatTurnBusy(
          merge(initialStore, {
            ...base,
            mainSendMessageOperations: { [mapKey]: { isLoading: true } },
          }),
        ),
      ).toBe(true);
      expect(
        chatSelectors.isCurrentChatTurnBusy(
          merge(initialStore, {
            ...base,
            preSendCompactionOperations: {
              [mapKey]: { abortController: new AbortController() },
            },
          }),
        ),
      ).toBe(true);
    });

    it('ignores a sibling thread while the main lane is idle', () => {
      const state = merge(initialStore, {
        ...base,
        messageInToolsCallingIds: ['thread-assistant'],
        messagesMap: {
          [mapKey]: [
            ...messages,
            {
              content: 'thread reply',
              id: 'thread-assistant',
              role: 'assistant',
              threadId: 'thread-b',
              tools: [{ id: 'call-thread' }],
            },
          ],
        },
        serverGenerationOperations: {
          [mapKey]: {
            opThread: {
              clearGeneration: 1,
              generation: 1,
              kind: 'chat',
              lane: 'lane-thread',
              operationId: 'opThread',
              sessionId: activeId,
              threadId: 'thread-b',
              topicId,
              userScope: 'user:a',
            },
          },
        },
        deferredBrowserGenerationLanes: {
          [`${mapKey}:thread-b`]: {
            assistantMessageId: 'thread-assistant',
            reason: 'unsupported_tool',
          },
        },
      });

      expect(chatSelectors.isCurrentChatTurnBusy(state)).toBe(false);
    });

    it('stays busy for the selected thread, including its main-topic prefix', () => {
      const threadMessages = [
        { content: 'hi', id: 'user-1', role: 'user' },
        {
          content: 'thread reply',
          id: 'thread-assistant',
          role: 'assistant',
          threadId: 'thread-b',
          tools: [{ id: 'call-thread' }],
        },
      ] as UIChatMessage[];
      const threadMap = {
        [topicId]: [{ id: 'thread-b', sourceMessageId: 'user-1' }],
      };
      const selected = {
        ...base,
        activeThreadId: 'thread-b',
        messageInToolsCallingIds: ['thread-assistant'],
        messagesMap: { [mapKey]: threadMessages },
        threadMaps: threadMap,
      };

      expect(chatSelectors.isCurrentChatTurnBusy(merge(initialStore, selected))).toBe(true);
      expect(
        chatSelectors.isCurrentChatTurnBusy(
          merge(initialStore, {
            ...selected,
            messageInToolsCallingIds: [],
            reasoningLoadingIds: ['user-1'],
          }),
        ),
      ).toBe(true);
      expect(
        chatSelectors.isCurrentChatTurnBusy(
          merge(initialStore, {
            ...base,
            messagesMap: { [mapKey]: [] },
            portalThreadId: 'thread-b',
            serverGenerationOperations: {
              [mapKey]: {
                opThread: {
                  clearGeneration: 1,
                  generation: 1,
                  kind: 'chat',
                  lane: 'lane-thread',
                  operationId: 'opThread',
                  sessionId: activeId,
                  threadId: 'thread-b',
                  topicId,
                  userScope: 'user:a',
                },
              },
            },
          }),
        ),
      ).toBe(true);
    });
  });

  describe('mainAIChatsRaw', () => {
    it('matches mainAIChats membership without cloning meta', () => {
      const spy = vi.spyOn(userProfileSelectors, 'userAvatar');
      const state = merge(initialStore, {
        activeId: 'active-session',
        messagesMap: {
          [messageMapKey('active-session')]: [
            ...mockMessages,
            {
              content: 'thread reply',
              id: 'thread-1',
              role: 'assistant',
              threadId: 'other-thread',
            },
          ],
        },
      });

      const rawIds = chatSelectors.mainAIChatsRaw(state).map((message) => message.id);
      expect(spy).not.toHaveBeenCalled();
      expect(rawIds).toEqual(chatSelectors.mainAIChats(state).map((message) => message.id));
      expect(rawIds).not.toContain('thread-1');
      spy.mockRestore();
    });
  });

  describe('showInboxWelcome', () => {
    it('should return false if the active session is not the inbox session', () => {
      const state = merge(initialStore, { activeId: 'someActiveId' });
      const result = chatSelectors.showInboxWelcome(state);
      expect(result).toBe(false);
    });

    it('should return false if there are existing messages in the inbox session', () => {
      const state = merge(initialStore, {
        activeId: INBOX_SESSION_ID,
        messagesMap: {
          [messageMapKey('inbox')]: mockMessages,
        },
      });
      const result = chatSelectors.showInboxWelcome(state);
      expect(result).toBe(false);
    });

    it('should return true if the active session is the inbox session and there are no existing messages', () => {
      const state = merge(initialStore, {
        activeId: INBOX_SESSION_ID,
        messages: [],
      });
      const result = chatSelectors.showInboxWelcome(state);
      expect(result).toBe(true);
    });
  });

  describe('currentToolMessages', () => {
    it('should return only tool messages', () => {
      const messages = [
        { id: '1', role: 'user', content: 'Hello' },
        { id: '2', role: 'assistant', content: 'Hi' },
        { id: '3', role: 'tool', content: 'Tool message 1' },
        { id: '4', role: 'user', content: 'Query' },
        { id: '5', role: 'tool', tools: [] },
      ] as UIChatMessage[];
      const state: Partial<ChatStore> = {
        activeId: 'test-id',
        messagesMap: {
          [messageMapKey('test-id')]: messages,
        },
      };
      const result = chatSelectors.currentToolMessages(state as ChatStore);
      expect(result).toHaveLength(2);
      expect(result.every((msg) => msg.role === 'tool')).toBe(true);
    });

    it('should return an empty array when no tool messages exist', () => {
      const messages = [
        { id: '1', role: 'user', content: 'Hello' },
        { id: '2', role: 'assistant', content: 'Hi' },
      ] as UIChatMessage[];
      const state: Partial<ChatStore> = {
        activeId: 'test-id',
        messagesMap: {
          [messageMapKey('test-id')]: messages,
        },
      };
      const result = chatSelectors.currentToolMessages(state as ChatStore);
      expect(result).toHaveLength(0);
    });
  });

  describe('currentChatKey', () => {
    it('should generate correct key with activeId only', () => {
      const state: Partial<ChatStore> = {
        activeId: 'testId',
        activeTopicId: undefined,
      };
      const result = chatSelectors.currentChatKey(state as ChatStore);
      expect(result).toBe(messageMapKey('testId', undefined));
    });

    it('should generate correct key with both activeId and activeTopicId', () => {
      const state: Partial<ChatStore> = {
        activeId: 'testId',
        activeTopicId: 'topicId',
      };
      const result = chatSelectors.currentChatKey(state as ChatStore);
      expect(result).toBe(messageMapKey('testId', 'topicId'));
    });

    it('should generate key with undefined activeId', () => {
      const state: Partial<ChatStore> = {
        activeId: undefined,
        activeTopicId: 'topicId',
      };
      const result = chatSelectors.currentChatKey(state as ChatStore);
      expect(result).toBe(messageMapKey(undefined as any, 'topicId'));
    });

    it('should generate key with empty string activeId', () => {
      const state: Partial<ChatStore> = {
        activeId: '',
        activeTopicId: undefined,
      };
      const result = chatSelectors.currentChatKey(state as ChatStore);
      expect(result).toBe(messageMapKey('', undefined));
    });
  });

  describe('isToolCallStreaming', () => {
    it('should return true when tool call is streaming for given message and index', () => {
      const state: Partial<ChatStore> = {
        toolCallingStreamIds: {
          'msg-1': [true, false, true],
        },
      };
      expect(chatSelectors.isToolCallStreaming('msg-1', 0)(state as ChatStore)).toBe(true);
      expect(chatSelectors.isToolCallStreaming('msg-1', 2)(state as ChatStore)).toBe(true);
    });

    it('should return false when tool call is not streaming for given message and index', () => {
      const state: Partial<ChatStore> = {
        toolCallingStreamIds: {
          'msg-1': [true, false, true],
        },
      };
      expect(chatSelectors.isToolCallStreaming('msg-1', 1)(state as ChatStore)).toBe(false);
      expect(chatSelectors.isToolCallStreaming('msg-2', 0)(state as ChatStore)).toBe(false);
    });

    it('should return false when no streaming data exists for the message', () => {
      const state: Partial<ChatStore> = {
        toolCallingStreamIds: {},
      };
      expect(chatSelectors.isToolCallStreaming('msg-1', 0)(state as ChatStore)).toBe(false);
    });
  });

  describe('isMessageAwaitingServerGeneration', () => {
    it('returns true when the message is in chatLoadingIds', () => {
      const state: Partial<ChatStore> = {
        chatLoadingIds: ['msg-1'],
        serverGenerationOperations: {},
      };
      expect(chatSelectors.isMessageAwaitingServerGeneration('msg-1')(state as ChatStore)).toBe(
        true,
      );
      expect(chatSelectors.isMessageAwaitingServerGeneration('msg-2')(state as ChatStore)).toBe(
        false,
      );
    });

    it('returns true when an attached operation owns the assistant message', () => {
      const state: Partial<ChatStore> = {
        chatLoadingIds: [],
        serverGenerationOperations: {
          [messageMapKey('session-1', 'topic-1')]: {
            cgo_one: {
              assistantMessageId: 'msg-1',
              generation: 0,
              kind: 'chat',
              lane: 'lane-main',
              operationId: 'cgo_one',
              sessionId: 'session-1',
              topicId: 'topic-1',
              userScope: 'current',
            },
          },
        },
      };
      expect(chatSelectors.isMessageAwaitingServerGeneration('msg-1')(state as ChatStore)).toBe(
        true,
      );
      expect(chatSelectors.isMessageAwaitingServerGeneration('msg-2')(state as ChatStore)).toBe(
        false,
      );
    });
  });

  describe('activeBaseChats with group chat messages', () => {
    it('should retrieve agent meta for group chat messages with groupId and agentId', () => {
      const groupChatMessages = [
        {
          id: 'msg1',
          content: 'Hello from agent',
          role: 'assistant',
          groupId: 'group-123',
          agentId: 'agent-456',
        },
      ] as UIChatMessage[];

      const state = merge(initialStore, {
        messagesMap: {
          [messageMapKey('group-123')]: groupChatMessages,
        },
        activeId: 'group-123',
      });

      const chats = chatSelectors.activeBaseChats(state);
      expect(chats).toHaveLength(1);
      expect(chats[0].id).toBe('msg1');
      expect(chats[0].meta).toBeDefined();
    });
  });
});
