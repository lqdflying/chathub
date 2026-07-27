import { and, desc, eq, getTableColumns, inArray } from 'drizzle-orm';

import {
  ChatGroupAgentItem,
  ChatGroupItem,
  NewAgent,
  NewChatGroup,
  NewChatGroupAgent,
  NewSession,
  agents,
  chatGroups,
  chatGroupsAgents,
} from '../schemas';
import { LobeChatDatabase } from '../type';
import { SessionModel } from './session';

export interface CreateChatGroupMemberSession {
  config: Partial<NewAgent>;
  session: Partial<NewSession>;
}

export interface CreateChatGroupParams {
  agentIds?: string[];
  group: Omit<NewChatGroup, 'userId'>;
  virtualSessions?: CreateChatGroupMemberSession[];
}

export interface CreateChatGroupResult {
  group: ChatGroupItem;
  virtualMembers: Array<{
    agentId: string;
    sessionId: string;
  }>;
}

export class ChatGroupModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }
  // ******* Query Methods ******* //

  async findById(id: string): Promise<ChatGroupItem | undefined> {
    const item = await this.db.query.chatGroups.findFirst({
      where: and(eq(chatGroups.id, id), eq(chatGroups.userId, this.userId)),
    });

    return item;
  }

  async query(): Promise<ChatGroupItem[]> {
    return this.db.query.chatGroups.findMany({
      orderBy: [desc(chatGroups.updatedAt)],
      where: eq(chatGroups.userId, this.userId),
    });
  }

  async queryWithMemberDetails(): Promise<any[]> {
    const groups = await this.query();
    if (groups.length === 0) return [];

    const groupIds = groups.map((g) => g.id);

    const groupAgents = await this.db
      .select({
        agent: agents,
        chatGroupId: chatGroupsAgents.chatGroupId,
      })
      .from(chatGroupsAgents)
      .innerJoin(
        chatGroups,
        and(
          eq(chatGroups.id, chatGroupsAgents.chatGroupId),
          eq(chatGroups.userId, chatGroupsAgents.userId),
        ),
      )
      .innerJoin(
        agents,
        and(eq(agents.id, chatGroupsAgents.agentId), eq(agents.userId, chatGroupsAgents.userId)),
      )
      .where(
        and(
          inArray(chatGroupsAgents.chatGroupId, groupIds),
          eq(chatGroupsAgents.userId, this.userId),
          eq(chatGroups.userId, this.userId),
          eq(agents.userId, this.userId),
        ),
      );

    const groupAgentMap = new Map<string, any[]>();

    for (const groupAgent of groupAgents) {
      const groupList = groupAgentMap.get(groupAgent.chatGroupId) || [];
      groupList.push(groupAgent.agent);
      groupAgentMap.set(groupAgent.chatGroupId, groupList);
    }

    return groups.map((group) => ({
      ...group,
      members: groupAgentMap.get(group.id) || [],
    }));
  }

  async findGroupWithAgents(groupId: string): Promise<{
    agents: ChatGroupAgentItem[];
    group: ChatGroupItem;
  } | null> {
    const group = await this.findById(groupId);
    if (!group) return null;

    const agents = await this.getGroupAgents(groupId);

    return { agents, group };
  }

  // ******* Create Methods ******* //

  async create(params: Omit<NewChatGroup, 'userId'>): Promise<ChatGroupItem> {
    const [result] = await this.db
      .insert(chatGroups)
      .values({ ...params, userId: this.userId })
      .returning();

    return result;
  }

  async createWithMembers({
    agentIds = [],
    group: groupParams,
    virtualSessions = [],
  }: CreateChatGroupParams): Promise<CreateChatGroupResult> {
    return this.db.transaction(async (transaction) => {
      const uniqueAgentIds = [...new Set(agentIds)];
      if (uniqueAgentIds.length !== agentIds.length) {
        throw new Error('One or more agents were not found or access was denied');
      }

      if (uniqueAgentIds.length > 0) {
        const ownedAgents = await transaction
          .select({ id: agents.id })
          .from(agents)
          .where(and(inArray(agents.id, uniqueAgentIds), eq(agents.userId, this.userId)));

        if (ownedAgents.length !== uniqueAgentIds.length) {
          throw new Error('One or more agents were not found or access was denied');
        }
      }

      const [group] = await transaction
        .insert(chatGroups)
        .values({ ...groupParams, userId: this.userId })
        .returning();

      const sessionModel = new SessionModel(this.db, this.userId);
      const virtualMembers: CreateChatGroupResult['virtualMembers'] = [];
      for (const virtualSession of virtualSessions) {
        const createdSession = await sessionModel.createInTransaction(transaction, {
          config: virtualSession.config,
          session: virtualSession.session,
          type: 'agent',
        });
        if (!createdSession.agentId) {
          throw new Error('Virtual group member creation failed');
        }

        uniqueAgentIds.push(createdSession.agentId);
        virtualMembers.push({
          agentId: createdSession.agentId,
          sessionId: createdSession.session.id,
        });
      }

      if (uniqueAgentIds.length > 0) {
        const memberships: NewChatGroupAgent[] = uniqueAgentIds.map((agentId) => ({
          agentId,
          chatGroupId: group.id,
          enabled: true,
          order: 0,
          role: 'participant',
          userId: this.userId,
        }));

        await transaction.insert(chatGroupsAgents).values(memberships);
      }

      return { group, virtualMembers };
    });
  }

  async createWithAgents(
    groupParams: Omit<NewChatGroup, 'userId'>,
    agentIds: string[],
  ): Promise<{ agents: NewChatGroupAgent[]; group: ChatGroupItem }> {
    const result = await this.createWithMembers({ agentIds, group: groupParams });
    return {
      agents: await this.getGroupAgents(result.group.id),
      group: result.group,
    };
  }

  // ******* Update Methods ******* //

  async update(id: string, value: Partial<ChatGroupItem>): Promise<ChatGroupItem> {
    const [result] = await this.db
      .update(chatGroups)
      .set({ ...value, updatedAt: new Date() })
      .where(and(eq(chatGroups.id, id), eq(chatGroups.userId, this.userId)))
      .returning();

    if (!result) {
      throw new Error('Chat group not found or access denied');
    }

    return result;
  }

  async addAgentToGroup(
    groupId: string,
    agentId: string,
    options?: { order?: number; role?: string },
  ): Promise<NewChatGroupAgent> {
    return this.db.transaction(async (transaction) => {
      const [ownedGroup] = await transaction
        .select({ id: chatGroups.id })
        .from(chatGroups)
        .where(and(eq(chatGroups.id, groupId), eq(chatGroups.userId, this.userId)))
        .limit(1);
      const [ownedAgent] = await transaction
        .select({ id: agents.id })
        .from(agents)
        .where(and(eq(agents.id, agentId), eq(agents.userId, this.userId)))
        .limit(1);

      if (!ownedGroup || !ownedAgent) {
        throw new Error('Group or agent not found or access denied');
      }

      const params: NewChatGroupAgent = {
        agentId,
        chatGroupId: groupId,
        order: options?.order ?? 0,
        role: options?.role ?? 'assistant',
        userId: this.userId,
      };

      const [result] = await transaction.insert(chatGroupsAgents).values(params).returning();
      return result;
    });
  }

  async addAgentsToGroup(groupId: string, agentIds: string[]): Promise<ChatGroupAgentItem[]> {
    return this.db.transaction(async (transaction) => {
      const uniqueAgentIds = [...new Set(agentIds)];
      if (uniqueAgentIds.length !== agentIds.length) {
        throw new Error('One or more agents already belong to this group');
      }

      const [ownedGroup] = await transaction
        .select({ id: chatGroups.id })
        .from(chatGroups)
        .where(and(eq(chatGroups.id, groupId), eq(chatGroups.userId, this.userId)))
        .limit(1);
      if (!ownedGroup) throw new Error('Group not found or access denied');
      if (uniqueAgentIds.length === 0) return [];

      const ownedAgents = await transaction
        .select({ id: agents.id })
        .from(agents)
        .where(and(inArray(agents.id, uniqueAgentIds), eq(agents.userId, this.userId)));
      if (ownedAgents.length !== uniqueAgentIds.length) {
        throw new Error('One or more agents were not found or access was denied');
      }

      const existingAgents = await transaction
        .select({ agentId: chatGroupsAgents.agentId })
        .from(chatGroupsAgents)
        .where(
          and(
            eq(chatGroupsAgents.chatGroupId, groupId),
            eq(chatGroupsAgents.userId, this.userId),
            inArray(chatGroupsAgents.agentId, uniqueAgentIds),
          ),
        );
      if (existingAgents.length > 0) {
        throw new Error('One or more agents already belong to this group');
      }

      const newAgents: NewChatGroupAgent[] = uniqueAgentIds.map((agentId) => ({
        agentId,
        chatGroupId: groupId,
        enabled: true,
        userId: this.userId,
      }));

      return transaction.insert(chatGroupsAgents).values(newAgents).returning();
    });
  }

  async removeAgentFromGroup(groupId: string, agentId: string): Promise<void> {
    await this.removeAgentsFromGroup(groupId, [agentId]);
  }

  async removeAgentsFromGroup(groupId: string, agentIds: string[]): Promise<void> {
    const uniqueAgentIds = [...new Set(agentIds)];
    if (uniqueAgentIds.length === 0 || uniqueAgentIds.length !== agentIds.length) {
      throw new Error('Group membership not found or access denied');
    }

    await this.db.transaction(async (transaction) => {
      const [ownedGroup] = await transaction
        .select({ id: chatGroups.id })
        .from(chatGroups)
        .where(and(eq(chatGroups.id, groupId), eq(chatGroups.userId, this.userId)))
        .limit(1);

      if (!ownedGroup) {
        throw new Error('Group membership not found or access denied');
      }

      const ownedMemberships = await transaction
        .select({ agentId: chatGroupsAgents.agentId })
        .from(chatGroupsAgents)
        .innerJoin(
          chatGroups,
          and(
            eq(chatGroups.id, chatGroupsAgents.chatGroupId),
            eq(chatGroups.userId, chatGroupsAgents.userId),
          ),
        )
        .innerJoin(
          agents,
          and(eq(agents.id, chatGroupsAgents.agentId), eq(agents.userId, chatGroupsAgents.userId)),
        )
        .where(
          and(
            eq(chatGroupsAgents.chatGroupId, groupId),
            inArray(chatGroupsAgents.agentId, uniqueAgentIds),
            eq(chatGroupsAgents.userId, this.userId),
            eq(chatGroups.userId, this.userId),
            eq(agents.userId, this.userId),
          ),
        );

      if (ownedMemberships.length !== uniqueAgentIds.length) {
        throw new Error('Group membership not found or access denied');
      }

      const deletedMemberships = await transaction
        .delete(chatGroupsAgents)
        .where(
          and(
            eq(chatGroupsAgents.chatGroupId, groupId),
            inArray(chatGroupsAgents.agentId, uniqueAgentIds),
            eq(chatGroupsAgents.userId, this.userId),
          ),
        )
        .returning({ agentId: chatGroupsAgents.agentId });

      if (deletedMemberships.length !== uniqueAgentIds.length) {
        throw new Error('Group membership not found or access denied');
      }
    });
  }

  async updateAgentInGroup(
    groupId: string,
    agentId: string,
    updates: Partial<Pick<NewChatGroupAgent, 'enabled' | 'order' | 'role'>>,
  ): Promise<NewChatGroupAgent> {
    return this.db.transaction(async (transaction) => {
      const [ownedMembership] = await transaction
        .select({ agentId: chatGroupsAgents.agentId })
        .from(chatGroupsAgents)
        .innerJoin(
          chatGroups,
          and(
            eq(chatGroups.id, chatGroupsAgents.chatGroupId),
            eq(chatGroups.userId, chatGroupsAgents.userId),
          ),
        )
        .innerJoin(
          agents,
          and(eq(agents.id, chatGroupsAgents.agentId), eq(agents.userId, chatGroupsAgents.userId)),
        )
        .where(
          and(
            eq(chatGroupsAgents.chatGroupId, groupId),
            eq(chatGroupsAgents.agentId, agentId),
            eq(chatGroupsAgents.userId, this.userId),
            eq(chatGroups.userId, this.userId),
            eq(agents.userId, this.userId),
          ),
        )
        .limit(1);

      if (!ownedMembership) {
        throw new Error('Group membership not found or access denied');
      }

      const [result] = await transaction
        .update(chatGroupsAgents)
        .set({ ...updates, updatedAt: new Date() })
        .where(
          and(
            eq(chatGroupsAgents.chatGroupId, groupId),
            eq(chatGroupsAgents.agentId, agentId),
            eq(chatGroupsAgents.userId, this.userId),
          ),
        )
        .returning();

      return result;
    });
  }

  // ******* Delete Methods ******* //

  async delete(id: string): Promise<ChatGroupItem> {
    // Agents are automatically deleted due to CASCADE constraint
    const [result] = await this.db
      .delete(chatGroups)
      .where(and(eq(chatGroups.id, id), eq(chatGroups.userId, this.userId)))
      .returning();

    if (!result) {
      throw new Error('Chat group not found or access denied');
    }

    return result;
  }

  async deleteAll(): Promise<void> {
    await this.db.delete(chatGroups).where(eq(chatGroups.userId, this.userId));
  }

  // ******* Agent Query Methods ******* //

  async getGroupAgents(groupId: string): Promise<ChatGroupAgentItem[]> {
    return this.db
      .select(getTableColumns(chatGroupsAgents))
      .from(chatGroupsAgents)
      .innerJoin(
        chatGroups,
        and(
          eq(chatGroups.id, chatGroupsAgents.chatGroupId),
          eq(chatGroups.userId, chatGroupsAgents.userId),
        ),
      )
      .innerJoin(
        agents,
        and(eq(agents.id, chatGroupsAgents.agentId), eq(agents.userId, chatGroupsAgents.userId)),
      )
      .where(
        and(
          eq(chatGroupsAgents.chatGroupId, groupId),
          eq(chatGroupsAgents.userId, this.userId),
          eq(chatGroups.userId, this.userId),
          eq(agents.userId, this.userId),
        ),
      )
      .orderBy(chatGroupsAgents.order);
  }

  async getEnabledGroupAgents(groupId: string): Promise<ChatGroupAgentItem[]> {
    return this.db
      .select(getTableColumns(chatGroupsAgents))
      .from(chatGroupsAgents)
      .innerJoin(
        chatGroups,
        and(
          eq(chatGroups.id, chatGroupsAgents.chatGroupId),
          eq(chatGroups.userId, chatGroupsAgents.userId),
        ),
      )
      .innerJoin(
        agents,
        and(eq(agents.id, chatGroupsAgents.agentId), eq(agents.userId, chatGroupsAgents.userId)),
      )
      .where(
        and(
          eq(chatGroupsAgents.chatGroupId, groupId),
          eq(chatGroupsAgents.enabled, true),
          eq(chatGroupsAgents.userId, this.userId),
          eq(chatGroups.userId, this.userId),
          eq(agents.userId, this.userId),
        ),
      )
      .orderBy(chatGroupsAgents.order);
  }

  async getGroupsWithAgents(agentIds?: string[]): Promise<ChatGroupItem[]> {
    if (!agentIds || agentIds.length === 0) {
      return this.query();
    }

    // Find groups containing any of the specified agents
    const groupIds = await this.db
      .selectDistinct({ chatGroupId: chatGroupsAgents.chatGroupId })
      .from(chatGroupsAgents)
      .innerJoin(
        chatGroups,
        and(
          eq(chatGroups.id, chatGroupsAgents.chatGroupId),
          eq(chatGroups.userId, chatGroupsAgents.userId),
        ),
      )
      .innerJoin(
        agents,
        and(eq(agents.id, chatGroupsAgents.agentId), eq(agents.userId, chatGroupsAgents.userId)),
      )
      .where(
        and(
          eq(chatGroupsAgents.userId, this.userId),
          eq(chatGroups.userId, this.userId),
          eq(agents.userId, this.userId),
          inArray(chatGroupsAgents.agentId, agentIds),
        ),
      );

    if (groupIds.length === 0) return [];

    return this.db.query.chatGroups.findMany({
      orderBy: [desc(chatGroups.updatedAt)],
      where: and(
        inArray(
          chatGroups.id,
          groupIds.map((g) => g.chatGroupId),
        ),
        eq(chatGroups.userId, this.userId),
      ),
    });
  }
}
