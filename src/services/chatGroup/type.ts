import type { CreateChatGroupParams, CreateChatGroupResult } from '@/database/models/chatGroup';
import { ChatGroupAgentItem, ChatGroupItem, NewChatGroupAgent } from '@/database/schemas';

export interface IChatGroupService {
  addAgentsToGroup(groupId: string, agentIds: string[]): Promise<ChatGroupAgentItem[]>;
  createGroup(params: CreateChatGroupParams): Promise<CreateChatGroupResult>;
  deleteGroup(id: string): Promise<any>;
  getGroup(id: string): Promise<ChatGroupItem | undefined>;
  getGroupAgents(groupId: string): Promise<ChatGroupAgentItem[]>;
  getGroups(): Promise<ChatGroupItem[]>;
  removeAgentsFromGroup(groupId: string, agentIds: string[]): Promise<void>;
  updateAgentInGroup(
    groupId: string,
    agentId: string,
    updates: Partial<Pick<NewChatGroupAgent, 'enabled' | 'order' | 'role'>>,
  ): Promise<ChatGroupAgentItem>;
  updateGroup(id: string, value: Partial<ChatGroupItem>): Promise<ChatGroupItem>;
}
