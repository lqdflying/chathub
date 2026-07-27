// @vitest-environment node
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LobeChatDatabase } from '@/database/type';

import {
  NewChatGroup,
  agents as agentsTable,
  agentsToSessions,
  chatGroups,
  chatGroupsAgents,
  sessions,
  users,
} from '../../schemas';
import { ChatGroupModel } from '../chatGroup';
import { getTestDB } from './_util';

const userId = 'test-user';
const otherUserId = 'other-user';

const serverDB: LobeChatDatabase = await getTestDB();

type RelationAgent = {
  agentId: string;
  chatGroupId?: string;
  enabled?: boolean | null;
  order?: number | null;
  role?: string | null;
};

const toRelationAgents = (agents: unknown): RelationAgent[] => agents as RelationAgent[];

const chatGroupModel = new ChatGroupModel(serverDB, userId);

beforeEach(async () => {
  await serverDB.delete(users);
  // Create test users
  await serverDB.insert(users).values([{ id: userId }, { id: otherUserId }]);
});

afterEach(async () => {
  // Clean up test data
  await serverDB.delete(users);
});

describe('ChatGroupModel', () => {
  describe('findById', () => {
    it('should find chat group by ID for current user', async () => {
      // Create test data
      const testGroup: NewChatGroup = {
        id: 'test-group-1',
        userId,
        title: 'Test Group',
        description: 'Test group description',
        pinned: false,
      };

      await serverDB.insert(chatGroups).values(testGroup);

      // Test finding the group
      const result = await chatGroupModel.findById('test-group-1');

      expect(result).toBeDefined();
      expect(result?.id).toBe('test-group-1');
      expect(result?.title).toBe('Test Group');
      expect(result?.userId).toBe(userId);
    });

    it('should return undefined for non-existent group', async () => {
      const result = await chatGroupModel.findById('non-existent');
      expect(result).toBeUndefined();
    });

    it('should not find groups belonging to other users', async () => {
      // Create group for other user
      await serverDB.insert(chatGroups).values({
        id: 'other-group',
        userId: otherUserId,
        title: 'Other User Group',
      });

      // Should not find it
      const result = await chatGroupModel.findById('other-group');
      expect(result).toBeUndefined();
    });
  });

  describe('query', () => {
    it('should return chat groups for current user only', async () => {
      // Create test data
      await serverDB.insert(chatGroups).values([
        {
          id: 'group-1',
          userId,
          title: 'Group 1',
          updatedAt: new Date('2024-01-01T10:00:00Z'),
        },
        {
          id: 'group-2',
          userId,
          title: 'Group 2',
          updatedAt: new Date('2024-01-02T10:00:00Z'),
        },
        {
          id: 'group-3',
          userId: otherUserId,
          title: 'Other Group',
          updatedAt: new Date('2024-01-03T10:00:00Z'),
        },
      ]);

      const result = await chatGroupModel.query();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('group-2'); // Most recent first (desc order)
      expect(result[1].id).toBe('group-1');
      expect(result.every((group) => group.userId === userId)).toBe(true);
    });

    it('should return empty array when no groups exist', async () => {
      const result = await chatGroupModel.query();
      expect(result).toEqual([]);
    });
  });

  describe('queryWithMemberDetails', () => {
    it('should return groups with their agent members', async () => {
      // Create test data
      await serverDB.transaction(async (trx) => {
        // Create groups
        await trx.insert(chatGroups).values([
          { id: 'group-1', userId, title: 'Group 1' },
          { id: 'group-2', userId, title: 'Group 2' },
        ]);

        // Create agents
        await trx.insert(agentsTable).values([
          { id: 'agent-1', userId, title: 'Agent 1' },
          { id: 'agent-2', userId, title: 'Agent 2' },
          { id: 'agent-3', userId, title: 'Agent 3' },
        ]);

        // Link agents to groups
        await trx.insert(chatGroupsAgents).values([
          { chatGroupId: 'group-1', agentId: 'agent-1', userId },
          { chatGroupId: 'group-1', agentId: 'agent-2', userId },
          { chatGroupId: 'group-2', agentId: 'agent-3', userId },
        ]);
      });

      const result = await chatGroupModel.queryWithMemberDetails();

      expect(result).toHaveLength(2);

      const group1 = result.find((g) => g.id === 'group-1');
      expect(group1?.members).toHaveLength(2);
      expect(group1?.members.map((m: any) => m.title)).toEqual(
        expect.arrayContaining(['Agent 1', 'Agent 2']),
      );

      const group2 = result.find((g) => g.id === 'group-2');
      expect(group2?.members).toHaveLength(1);
      expect(group2?.members[0].title).toBe('Agent 3');
    });

    it('should return groups with empty members array when no agents assigned', async () => {
      await serverDB.insert(chatGroups).values({
        id: 'group-no-agents',
        userId,
        title: 'Group without agents',
      });

      const result = await chatGroupModel.queryWithMemberDetails();

      expect(result).toHaveLength(1);
      expect(result[0].members).toEqual([]);
    });

    it('should return empty array when no groups exist', async () => {
      const result = await chatGroupModel.queryWithMemberDetails();
      expect(result).toEqual([]);
    });

    it('should omit a legacy membership whose owner does not match the group and agent', async () => {
      await serverDB.transaction(async (transaction) => {
        await transaction.execute(sql`
          ALTER TABLE "chat_groups_agents"
          DROP CONSTRAINT "chat_groups_agents_agent_id_user_id_agents_id_user_id_fk"
        `);
        await transaction
          .insert(chatGroups)
          .values({ id: 'owned-group-with-corrupt-member', title: 'Owned Group', userId });
        await transaction
          .insert(agentsTable)
          .values({ id: 'other-user-agent', title: 'Other Agent', userId: otherUserId });
        await transaction.insert(chatGroupsAgents).values({
          agentId: 'other-user-agent',
          chatGroupId: 'owned-group-with-corrupt-member',
          userId,
        });

        const transactionModel = new ChatGroupModel(transaction as LobeChatDatabase, userId);
        const result = await transactionModel.queryWithMemberDetails();

        expect(result).toHaveLength(1);
        expect(result[0].members).toEqual([]);

        await transaction
          .delete(chatGroupsAgents)
          .where(eq(chatGroupsAgents.chatGroupId, 'owned-group-with-corrupt-member'));
        await transaction.execute(sql`
          ALTER TABLE "chat_groups_agents"
          ADD CONSTRAINT "chat_groups_agents_agent_id_user_id_agents_id_user_id_fk"
          FOREIGN KEY ("agent_id", "user_id")
          REFERENCES "public"."agents"("id", "user_id")
          ON DELETE no action
          ON UPDATE no action
        `);
      });
    });
  });

  describe('findGroupWithAgents', () => {
    it('should return group with its agents', async () => {
      // Create test data
      await serverDB.transaction(async (trx) => {
        await trx.insert(chatGroups).values({
          id: 'group-with-agents',
          userId,
          title: 'Group with Agents',
        });

        await trx.insert(agentsTable).values([
          { id: 'agent-1', userId, title: 'Agent 1' },
          { id: 'agent-2', userId, title: 'Agent 2' },
        ]);

        await trx.insert(chatGroupsAgents).values([
          { chatGroupId: 'group-with-agents', agentId: 'agent-1', userId, order: 1 },
          { chatGroupId: 'group-with-agents', agentId: 'agent-2', userId, order: 2 },
        ]);
      });

      const result = await chatGroupModel.findGroupWithAgents('group-with-agents');

      expect(result).toBeDefined();
      expect(result?.group.id).toBe('group-with-agents');
      const agents = toRelationAgents(result?.agents ?? []);
      expect(agents).toHaveLength(2);
      // Should be ordered by order field
      expect(agents[0]?.agentId).toBe('agent-1');
      expect(agents[1]?.agentId).toBe('agent-2');
    });

    it('should return null for non-existent group', async () => {
      const result = await chatGroupModel.findGroupWithAgents('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('should create a new chat group', async () => {
      const groupData: Omit<NewChatGroup, 'userId'> = {
        title: 'New Chat Group',
        description: 'A test chat group',
        pinned: true,
        config: {
          maxResponseInRow: 5,
          responseOrder: 'sequential',
          scene: 'casual',
        },
      };

      const result = await chatGroupModel.create(groupData);

      expect(result).toBeDefined();
      expect(result.userId).toBe(userId);
      expect(result.title).toBe('New Chat Group');
      expect(result.description).toBe('A test chat group');
      expect(result.pinned).toBe(true);
      expect(result.config).toEqual({
        maxResponseInRow: 5,
        responseOrder: 'sequential',
        scene: 'casual',
      });
      expect(result.id.startsWith('cg_')).toBe(true);
    });

    it('should create group with custom ID', async () => {
      const groupData: Omit<NewChatGroup, 'userId'> = {
        id: 'custom-group-id',
        title: 'Custom ID Group',
      };

      const result = await chatGroupModel.create(groupData);

      expect(result.id).toBe('custom-group-id');
      expect(result.title).toBe('Custom ID Group');
    });
  });

  describe('createWithAgents', () => {
    it('should create group and add agents', async () => {
      // Create test agents
      await serverDB.insert(agentsTable).values([
        { id: 'agent-1', userId, title: 'Agent 1' },
        { id: 'agent-2', userId, title: 'Agent 2' },
      ]);

      const groupData: Omit<NewChatGroup, 'userId'> = {
        title: 'Group with Agents',
        description: 'Group created with agents',
      };

      const result = await chatGroupModel.createWithAgents(groupData, ['agent-1', 'agent-2']);

      expect(result.group).toBeDefined();
      expect(result.group.title).toBe('Group with Agents');
      expect(result.agents).toHaveLength(2);
      expect(result.agents[0].agentId).toBe('agent-1');
      expect(result.agents[1].agentId).toBe('agent-2');
    });

    it('should create group with empty agents array', async () => {
      const groupData: Omit<NewChatGroup, 'userId'> = {
        title: 'Empty Group',
      };

      const result = await chatGroupModel.createWithAgents(groupData, []);

      expect(result.group).toBeDefined();
      expect(result.agents).toEqual([]);
    });

    it('should reject a mixed-owner agent set without creating the group', async () => {
      await serverDB.insert(agentsTable).values([
        { id: 'owned-create-agent', title: 'Owned Agent', userId },
        { id: 'foreign-create-agent', title: 'Foreign Agent', userId: otherUserId },
      ]);

      await expect(
        chatGroupModel.createWithAgents(
          { id: 'group-that-must-rollback', title: 'Rejected Group' },
          ['owned-create-agent', 'foreign-create-agent'],
        ),
      ).rejects.toThrow('One or more agents were not found or access was denied');

      const createdGroup = await serverDB
        .select()
        .from(chatGroups)
        .where(eq(chatGroups.id, 'group-that-must-rollback'));
      expect(createdGroup).toEqual([]);
    });
  });

  describe('createWithMembers', () => {
    it('should create a template group and virtual members across all tables', async () => {
      const result = await chatGroupModel.createWithMembers({
        group: {
          description: 'Atomic template group',
          id: 'atomic-template-group',
          title: 'Atomic Template Group',
        },
        virtualSessions: [
          {
            config: {
              plugins: ['template-plugin'],
              systemRole: 'Research the request',
              title: 'Researcher',
              virtual: true,
            },
            session: {
              avatar: 'researcher-avatar',
              description: 'Researcher - Atomic template group',
              title: 'Researcher',
            },
          },
          {
            config: {
              systemRole: 'Review the result',
              title: 'Reviewer',
              virtual: true,
            },
            session: {
              title: 'Reviewer',
            },
          },
        ],
      });

      expect(result.group.id).toBe('atomic-template-group');
      expect(result.virtualMembers).toHaveLength(2);

      const createdAgents = await serverDB
        .select()
        .from(agentsTable)
        .where(eq(agentsTable.userId, userId));
      expect(createdAgents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            plugins: ['template-plugin'],
            systemRole: 'Research the request',
            title: 'Researcher',
            virtual: true,
          }),
          expect.objectContaining({
            systemRole: 'Review the result',
            title: 'Reviewer',
            virtual: true,
          }),
        ]),
      );

      const createdSessions = await serverDB
        .select()
        .from(sessions)
        .where(eq(sessions.userId, userId));
      expect(createdSessions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            avatar: 'researcher-avatar',
            description: 'Researcher - Atomic template group',
            title: 'Researcher',
          }),
          expect.objectContaining({ title: 'Reviewer' }),
        ]),
      );

      const createdLinks = await serverDB
        .select()
        .from(agentsToSessions)
        .where(eq(agentsToSessions.userId, userId));
      expect(createdLinks).toHaveLength(2);

      const memberships = await serverDB
        .select()
        .from(chatGroupsAgents)
        .where(eq(chatGroupsAgents.chatGroupId, result.group.id));
      expect(memberships).toHaveLength(2);
      expect(memberships).toEqual(
        expect.arrayContaining(
          result.virtualMembers.map(({ agentId }) =>
            expect.objectContaining({
              agentId,
              enabled: true,
              order: 0,
              role: 'participant',
              userId,
            }),
          ),
        ),
      );
    });

    it('should roll back all group and virtual member tables after a late failure', async () => {
      await expect(
        chatGroupModel.createWithMembers({
          group: {
            id: 'late-failure-group',
            title: 'Late Failure Group',
          },
          virtualSessions: [
            {
              config: {
                slug: 'duplicate-virtual-agent',
                title: 'First Virtual Agent',
                virtual: true,
              },
              session: { title: 'First Virtual Session' },
            },
            {
              config: {
                slug: 'duplicate-virtual-agent',
                title: 'Second Virtual Agent',
                virtual: true,
              },
              session: { title: 'Second Virtual Session' },
            },
          ],
        }),
      ).rejects.toThrow();

      expect(
        await serverDB.select().from(chatGroups).where(eq(chatGroups.id, 'late-failure-group')),
      ).toEqual([]);
      expect(
        await serverDB.select().from(agentsTable).where(eq(agentsTable.userId, userId)),
      ).toEqual([]);
      expect(await serverDB.select().from(sessions).where(eq(sessions.userId, userId))).toEqual([]);
      expect(
        await serverDB.select().from(agentsToSessions).where(eq(agentsToSessions.userId, userId)),
      ).toEqual([]);
      expect(
        await serverDB.select().from(chatGroupsAgents).where(eq(chatGroupsAgents.userId, userId)),
      ).toEqual([]);
    });
  });

  describe('update', () => {
    it('should update chat group', async () => {
      // Create test group
      await serverDB.insert(chatGroups).values({
        id: 'update-test',
        userId,
        title: 'Original Title',
        description: 'Original description',
        pinned: false,
      });

      const updatedData = {
        title: 'Updated Title',
        description: 'Updated description',
        pinned: true,
      };

      const result = await chatGroupModel.update('update-test', updatedData);

      expect(result.id).toBe('update-test');
      expect(result.title).toBe('Updated Title');
      expect(result.description).toBe('Updated description');
      expect(result.pinned).toBe(true);
      expect(result.updatedAt).toBeInstanceOf(Date);
    });

    it('should not update groups belonging to other users', async () => {
      // Create group for other user
      await serverDB.insert(chatGroups).values({
        id: 'other-user-group',
        userId: otherUserId,
        title: 'Other User Group',
      });

      // Try to update - should throw
      await expect(
        chatGroupModel.update('other-user-group', { title: 'Hacked Title' }),
      ).rejects.toThrow('Chat group not found or access denied');
    });
  });

  describe('addAgentToGroup', () => {
    it('should add agent to group', async () => {
      // Create test data
      await serverDB.transaction(async (trx) => {
        await trx.insert(chatGroups).values({
          id: 'test-group',
          userId,
          title: 'Test Group',
        });

        await trx.insert(agentsTable).values({
          id: 'test-agent',
          userId,
          title: 'Test Agent',
        });
      });

      const result = await chatGroupModel.addAgentToGroup('test-group', 'test-agent', {
        order: 5,
        role: 'moderator',
      });

      expect(result.chatGroupId).toBe('test-group');
      expect(result.agentId).toBe('test-agent');
      expect(result.userId).toBe(userId);
      expect(result.order).toBe(5);
      expect(result.role).toBe('moderator');
    });

    it('should add agent with default options', async () => {
      // Create test data
      await serverDB.transaction(async (trx) => {
        await trx.insert(chatGroups).values({
          id: 'test-group-2',
          userId,
          title: 'Test Group 2',
        });

        await trx.insert(agentsTable).values({
          id: 'test-agent-2',
          userId,
          title: 'Test Agent 2',
        });
      });

      const result = await chatGroupModel.addAgentToGroup('test-group-2', 'test-agent-2');

      expect(result.order).toBe(0);
      expect(result.role).toBe('assistant');
    });

    it('should reject an agent owned by another user', async () => {
      await serverDB.transaction(async (transaction) => {
        await transaction
          .insert(chatGroups)
          .values({ id: 'owned-single-add-group', title: 'Owned Group', userId });
        await transaction
          .insert(agentsTable)
          .values({ id: 'foreign-single-add-agent', title: 'Foreign Agent', userId: otherUserId });
      });

      await expect(
        chatGroupModel.addAgentToGroup('owned-single-add-group', 'foreign-single-add-agent'),
      ).rejects.toThrow('Group or agent not found or access denied');

      expect(await chatGroupModel.getGroupAgents('owned-single-add-group')).toEqual([]);
    });
  });

  describe('addAgentsToGroup', () => {
    it('should add multiple agents to group', async () => {
      // Create test data
      await serverDB.transaction(async (trx) => {
        await trx.insert(chatGroups).values({
          id: 'multi-agent-group',
          userId,
          title: 'Multi Agent Group',
        });

        await trx.insert(agentsTable).values([
          { id: 'agent-1', userId, title: 'Agent 1' },
          { id: 'agent-2', userId, title: 'Agent 2' },
          { id: 'agent-3', userId, title: 'Agent 3' },
        ]);
      });

      const result = await chatGroupModel.addAgentsToGroup('multi-agent-group', [
        'agent-1',
        'agent-2',
        'agent-3',
      ]);

      const connectedAgents = toRelationAgents(result);
      expect(connectedAgents).toHaveLength(3);
      expect(connectedAgents.map((a) => a.agentId)).toEqual(['agent-1', 'agent-2', 'agent-3']);
    });

    it('should throw when adding duplicate agents', async () => {
      // Create test data
      await serverDB.transaction(async (trx) => {
        await trx.insert(chatGroups).values({
          id: 'existing-agent-group',
          userId,
          title: 'Existing Agent Group',
        });

        await trx.insert(agentsTable).values([
          { id: 'existing-agent', userId, title: 'Existing Agent' },
          { id: 'new-agent', userId, title: 'New Agent' },
        ]);

        // Add one agent already
        await trx.insert(chatGroupsAgents).values({
          chatGroupId: 'existing-agent-group',
          agentId: 'existing-agent',
          userId,
        });
      });

      await expect(
        chatGroupModel.addAgentsToGroup('existing-agent-group', ['existing-agent', 'new-agent']),
      ).rejects.toThrow();

      const groupAgents = toRelationAgents(
        await chatGroupModel.getGroupAgents('existing-agent-group'),
      );

      expect(groupAgents).toHaveLength(1);
      expect(groupAgents[0]?.agentId).toBe('existing-agent');
    });

    it('should throw when all agents already exist', async () => {
      // Create test data
      await serverDB.transaction(async (trx) => {
        await trx.insert(chatGroups).values({
          id: 'all-existing-group',
          userId,
          title: 'All Existing Group',
        });

        await trx.insert(agentsTable).values({
          id: 'existing-only',
          userId,
          title: 'Existing Only',
        });

        await trx.insert(chatGroupsAgents).values({
          chatGroupId: 'all-existing-group',
          agentId: 'existing-only',
          userId,
        });
      });

      await expect(
        chatGroupModel.addAgentsToGroup('all-existing-group', ['existing-only']),
      ).rejects.toThrow();
    });

    it('should throw error for non-existent group', async () => {
      await expect(
        chatGroupModel.addAgentsToGroup('non-existent-group', ['agent-1']),
      ).rejects.toThrow('Group not found or access denied');
    });

    it('should reject mixed-owner IDs atomically', async () => {
      await serverDB.transaction(async (transaction) => {
        await transaction
          .insert(chatGroups)
          .values({ id: 'mixed-owner-group', title: 'Owned Group', userId });
        await transaction.insert(agentsTable).values([
          { id: 'mixed-owned-agent', title: 'Owned Agent', userId },
          { id: 'mixed-foreign-agent', title: 'Foreign Agent', userId: otherUserId },
        ]);
      });

      await expect(
        chatGroupModel.addAgentsToGroup('mixed-owner-group', [
          'mixed-owned-agent',
          'mixed-foreign-agent',
        ]),
      ).rejects.toThrow('One or more agents were not found or access was denied');

      expect(await chatGroupModel.getGroupAgents('mixed-owner-group')).toEqual([]);
    });
  });

  describe('removeAgentFromGroup', () => {
    it('should remove agent from group', async () => {
      // Create test data
      await serverDB.transaction(async (trx) => {
        await trx.insert(chatGroups).values({
          id: 'remove-test-group',
          userId,
          title: 'Remove Test Group',
        });

        await trx.insert(agentsTable).values({
          id: 'remove-test-agent',
          userId,
          title: 'Remove Test Agent',
        });

        await trx.insert(chatGroupsAgents).values({
          chatGroupId: 'remove-test-group',
          agentId: 'remove-test-agent',
          userId,
        });
      });

      await chatGroupModel.removeAgentFromGroup('remove-test-group', 'remove-test-agent');

      // Verify agent was removed
      const groupAgents = await chatGroupModel.getGroupAgents('remove-test-group');
      expect(groupAgents).toHaveLength(0);
    });

    it('should reject removing a missing membership', async () => {
      await serverDB.insert(chatGroups).values({
        id: 'empty-group',
        userId,
        title: 'Empty Group',
      });

      await expect(
        chatGroupModel.removeAgentFromGroup('empty-group', 'non-existent-agent'),
      ).rejects.toThrow('Group membership not found or access denied');
    });

    it('should not remove a foreign-owned membership', async () => {
      await serverDB.transaction(async (transaction) => {
        await transaction
          .insert(chatGroups)
          .values({ id: 'foreign-remove-group', title: 'Foreign Group', userId: otherUserId });
        await transaction
          .insert(agentsTable)
          .values({ id: 'foreign-remove-agent', title: 'Foreign Agent', userId: otherUserId });
        await transaction.insert(chatGroupsAgents).values({
          agentId: 'foreign-remove-agent',
          chatGroupId: 'foreign-remove-group',
          userId: otherUserId,
        });
      });

      await expect(
        chatGroupModel.removeAgentFromGroup('foreign-remove-group', 'foreign-remove-agent'),
      ).rejects.toThrow('Group membership not found or access denied');

      const membership = await serverDB
        .select()
        .from(chatGroupsAgents)
        .where(eq(chatGroupsAgents.chatGroupId, 'foreign-remove-group'));
      expect(membership).toHaveLength(1);
    });
  });

  describe('removeAgentsFromGroup', () => {
    const ownedGroupId = 'plural-remove-owned-group';
    const otherOwnedGroupId = 'plural-remove-other-owned-group';
    const foreignGroupId = 'plural-remove-foreign-group';
    const ownedAgentIds = ['plural-remove-agent-one', 'plural-remove-agent-two'];
    const otherGroupAgentId = 'plural-remove-other-group-agent';
    const foreignAgentId = 'plural-remove-foreign-agent';

    const createRemovalFixture = async () => {
      await serverDB.transaction(async (transaction) => {
        await transaction.insert(chatGroups).values([
          { id: ownedGroupId, title: 'Owned Group', userId },
          { id: otherOwnedGroupId, title: 'Other Owned Group', userId },
          { id: foreignGroupId, title: 'Foreign Group', userId: otherUserId },
        ]);
        await transaction
          .insert(agentsTable)
          .values([
            ...ownedAgentIds.map((id) => ({ id, title: id, userId })),
            { id: otherGroupAgentId, title: 'Other Group Agent', userId },
            { id: foreignAgentId, title: 'Foreign Agent', userId: otherUserId },
          ]);
        await transaction.insert(chatGroupsAgents).values([
          ...ownedAgentIds.map((agentId) => ({
            agentId,
            chatGroupId: ownedGroupId,
            userId,
          })),
          {
            agentId: otherGroupAgentId,
            chatGroupId: otherOwnedGroupId,
            userId,
          },
          {
            agentId: foreignAgentId,
            chatGroupId: foreignGroupId,
            userId: otherUserId,
          },
        ]);
      });
    };

    const getMembershipIds = async () => {
      const memberships = await serverDB
        .select({
          agentId: chatGroupsAgents.agentId,
          chatGroupId: chatGroupsAgents.chatGroupId,
          userId: chatGroupsAgents.userId,
        })
        .from(chatGroupsAgents);

      return memberships
        .map(({ agentId, chatGroupId, userId: membershipUserId }) =>
          [membershipUserId, chatGroupId, agentId].join(':'),
        )
        .sort();
    };

    it('should remove multiple owned memberships in one request', async () => {
      await createRemovalFixture();

      await chatGroupModel.removeAgentsFromGroup(ownedGroupId, ownedAgentIds);

      expect(await chatGroupModel.getGroupAgents(ownedGroupId)).toEqual([]);
      expect(await chatGroupModel.getGroupAgents(otherOwnedGroupId)).toHaveLength(1);
      expect(
        await serverDB
          .select()
          .from(chatGroupsAgents)
          .where(eq(chatGroupsAgents.chatGroupId, foreignGroupId)),
      ).toHaveLength(1);
    });

    it.each([
      {
        agentIds: [ownedAgentIds[0], 'missing-agent'],
        groupId: ownedGroupId,
        name: 'valid and missing memberships',
      },
      {
        agentIds: [ownedAgentIds[0], foreignAgentId],
        groupId: ownedGroupId,
        name: 'valid and foreign memberships',
      },
      {
        agentIds: [otherGroupAgentId],
        groupId: ownedGroupId,
        name: 'membership from a different owned group',
      },
      {
        agentIds: [ownedAgentIds[0], ownedAgentIds[0]],
        groupId: ownedGroupId,
        name: 'duplicate membership IDs',
      },
      {
        agentIds: [],
        groupId: ownedGroupId,
        name: 'an empty membership set',
      },
      {
        agentIds: [ownedAgentIds[0]],
        groupId: 'missing-group',
        name: 'a missing group',
      },
      {
        agentIds: [foreignAgentId],
        groupId: foreignGroupId,
        name: 'a foreign group',
      },
    ])('should preserve all memberships when rejecting $name', async ({ agentIds, groupId }) => {
      await createRemovalFixture();
      const membershipsBefore = await getMembershipIds();

      await expect(chatGroupModel.removeAgentsFromGroup(groupId, agentIds)).rejects.toThrow(
        'Group membership not found or access denied',
      );

      expect(await getMembershipIds()).toEqual(membershipsBefore);
    });
  });

  describe('updateAgentInGroup', () => {
    it('should update agent settings in group', async () => {
      // Create test data
      await serverDB.transaction(async (trx) => {
        await trx.insert(chatGroups).values({
          id: 'update-agent-group',
          userId,
          title: 'Update Agent Group',
        });

        await trx.insert(agentsTable).values({
          id: 'update-agent',
          userId,
          title: 'Update Agent',
        });

        await trx.insert(chatGroupsAgents).values({
          chatGroupId: 'update-agent-group',
          agentId: 'update-agent',
          userId,
          enabled: true,
          order: 0,
          role: 'participant',
        });
      });

      const result = await chatGroupModel.updateAgentInGroup('update-agent-group', 'update-agent', {
        order: 5,
        role: 'moderator',
      });

      expect(result.order).toBe(5);
      expect(result.role).toBe('moderator');
      expect(result.updatedAt).toBeInstanceOf(Date);
    });

    it('should not update a foreign-owned membership', async () => {
      await serverDB.transaction(async (transaction) => {
        await transaction
          .insert(chatGroups)
          .values({ id: 'foreign-update-group', title: 'Foreign Group', userId: otherUserId });
        await transaction
          .insert(agentsTable)
          .values({ id: 'foreign-update-agent', title: 'Foreign Agent', userId: otherUserId });
        await transaction.insert(chatGroupsAgents).values({
          agentId: 'foreign-update-agent',
          chatGroupId: 'foreign-update-group',
          role: 'participant',
          userId: otherUserId,
        });
      });

      await expect(
        chatGroupModel.updateAgentInGroup('foreign-update-group', 'foreign-update-agent', {
          role: 'moderator',
        }),
      ).rejects.toThrow('Group membership not found or access denied');

      const [membership] = await serverDB
        .select()
        .from(chatGroupsAgents)
        .where(eq(chatGroupsAgents.chatGroupId, 'foreign-update-group'));
      expect(membership.role).toBe('participant');
    });
  });

  describe('delete', () => {
    it('should delete chat group', async () => {
      // Create test group
      await serverDB.insert(chatGroups).values({
        id: 'delete-test',
        userId,
        title: 'Delete Test',
      });

      const result = await chatGroupModel.delete('delete-test');

      expect(result.id).toBe('delete-test');

      // Verify group was deleted
      const groups = await serverDB
        .select()
        .from(chatGroups)
        .where(eq(chatGroups.id, 'delete-test'));
      expect(groups).toHaveLength(0);
    });

    it('should cascade delete associated agents', async () => {
      // Create test data
      await serverDB.transaction(async (trx) => {
        await trx.insert(chatGroups).values({
          id: 'cascade-delete-group',
          userId,
          title: 'Cascade Delete Group',
        });

        await trx.insert(agentsTable).values({
          id: 'cascade-agent',
          userId,
          title: 'Cascade Agent',
        });

        await trx.insert(chatGroupsAgents).values({
          chatGroupId: 'cascade-delete-group',
          agentId: 'cascade-agent',
          userId,
        });
      });

      await chatGroupModel.delete('cascade-delete-group');

      // Verify group and associated agents were deleted
      const groupAgents = await serverDB
        .select()
        .from(chatGroupsAgents)
        .where(eq(chatGroupsAgents.chatGroupId, 'cascade-delete-group'));
      expect(groupAgents).toHaveLength(0);
    });

    it('should not delete groups belonging to other users', async () => {
      // Create group for other user
      await serverDB.insert(chatGroups).values({
        id: 'other-user-delete',
        userId: otherUserId,
        title: 'Other User Delete',
      });

      // Try to delete - should throw
      await expect(chatGroupModel.delete('other-user-delete')).rejects.toThrow(
        'Chat group not found or access denied',
      );
    });
  });

  describe('deleteAll', () => {
    it('should delete all groups for current user only', async () => {
      // Create test data
      await serverDB.insert(chatGroups).values([
        { id: 'user-group-1', userId, title: 'User Group 1' },
        { id: 'user-group-2', userId, title: 'User Group 2' },
        { id: 'other-group', userId: otherUserId, title: 'Other Group' },
      ]);

      await chatGroupModel.deleteAll();

      // Verify only current user's groups were deleted
      const remainingGroups = await serverDB.select().from(chatGroups);
      expect(remainingGroups).toHaveLength(1);
      expect(remainingGroups[0].userId).toBe(otherUserId);
    });
  });

  describe('getGroupAgents', () => {
    it('should return agents in group ordered by order field', async () => {
      // Create test data
      await serverDB.transaction(async (trx) => {
        await trx.insert(chatGroups).values({
          id: 'ordered-group',
          userId,
          title: 'Ordered Group',
        });

        await trx.insert(agentsTable).values([
          { id: 'agent-1', userId, title: 'Agent 1' },
          { id: 'agent-2', userId, title: 'Agent 2' },
          { id: 'agent-3', userId, title: 'Agent 3' },
        ]);

        await trx.insert(chatGroupsAgents).values([
          { chatGroupId: 'ordered-group', agentId: 'agent-1', userId, order: 2 },
          { chatGroupId: 'ordered-group', agentId: 'agent-2', userId, order: 1 },
          { chatGroupId: 'ordered-group', agentId: 'agent-3', userId, order: 3 },
        ]);
      });

      const result = toRelationAgents(await chatGroupModel.getGroupAgents('ordered-group'));

      expect(result).toHaveLength(3);
      expect(result[0]?.agentId).toBe('agent-2'); // order: 1
      expect(result[1]?.agentId).toBe('agent-1'); // order: 2
      expect(result[2]?.agentId).toBe('agent-3'); // order: 3
    });

    it('should handle numeric ordering correctly (avoiding lexicographic sorting)', async () => {
      // This test ensures that order 10 comes after order 2 (not before like with text sorting)
      await serverDB.transaction(async (trx) => {
        await trx.insert(chatGroups).values({
          id: 'numeric-order-group',
          userId,
          title: 'Numeric Order Group',
        });

        await trx.insert(agentsTable).values([
          { id: 'agent-order-1', userId, title: 'Agent Order 1' },
          { id: 'agent-order-2', userId, title: 'Agent Order 2' },
          { id: 'agent-order-10', userId, title: 'Agent Order 10' },
        ]);

        await trx.insert(chatGroupsAgents).values([
          { chatGroupId: 'numeric-order-group', agentId: 'agent-order-10', userId, order: 10 },
          { chatGroupId: 'numeric-order-group', agentId: 'agent-order-2', userId, order: 2 },
          { chatGroupId: 'numeric-order-group', agentId: 'agent-order-1', userId, order: 1 },
        ]);
      });

      const result = toRelationAgents(await chatGroupModel.getGroupAgents('numeric-order-group'));

      expect(result).toHaveLength(3);
      // With integer ordering: 1, 2, 10 (correct)
      // With text ordering it would be: 1, 10, 2 (incorrect lexicographic)
      expect(result[0]?.agentId).toBe('agent-order-1'); // order: 1
      expect(result[1]?.agentId).toBe('agent-order-2'); // order: 2
      expect(result[2]?.agentId).toBe('agent-order-10'); // order: 10
    });

    it('should not enumerate another user group', async () => {
      await serverDB.transaction(async (transaction) => {
        await transaction
          .insert(chatGroups)
          .values({ id: 'foreign-read-group', title: 'Foreign Group', userId: otherUserId });
        await transaction
          .insert(agentsTable)
          .values({ id: 'foreign-read-agent', title: 'Foreign Agent', userId: otherUserId });
        await transaction.insert(chatGroupsAgents).values({
          agentId: 'foreign-read-agent',
          chatGroupId: 'foreign-read-group',
          userId: otherUserId,
        });
      });

      expect(await chatGroupModel.getGroupAgents('foreign-read-group')).toEqual([]);
    });
  });

  describe('getEnabledGroupAgents', () => {
    it('should return only enabled agents', async () => {
      // Create test data
      await serverDB.transaction(async (trx) => {
        await trx.insert(chatGroups).values({
          id: 'enabled-test-group',
          userId,
          title: 'Enabled Test Group',
        });

        await trx.insert(agentsTable).values([
          { id: 'enabled-agent', userId, title: 'Enabled Agent' },
          { id: 'disabled-agent', userId, title: 'Disabled Agent' },
        ]);

        await trx.insert(chatGroupsAgents).values([
          { chatGroupId: 'enabled-test-group', agentId: 'enabled-agent', userId, enabled: true },
          { chatGroupId: 'enabled-test-group', agentId: 'disabled-agent', userId, enabled: false },
        ]);
      });

      const result = toRelationAgents(
        await chatGroupModel.getEnabledGroupAgents('enabled-test-group'),
      );

      expect(result).toHaveLength(1);
      expect(result[0]?.agentId).toBe('enabled-agent');
    });
  });

  describe('getGroupsWithAgents', () => {
    it('should return groups containing specified agents', async () => {
      // Create test data
      await serverDB.transaction(async (trx) => {
        await trx.insert(chatGroups).values([
          { id: 'group-a', userId, title: 'Group A' },
          { id: 'group-b', userId, title: 'Group B' },
          { id: 'group-c', userId, title: 'Group C' },
        ]);

        await trx.insert(agentsTable).values([
          { id: 'agent-x', userId, title: 'Agent X' },
          { id: 'agent-y', userId, title: 'Agent Y' },
          { id: 'agent-z', userId, title: 'Agent Z' },
        ]);

        await trx.insert(chatGroupsAgents).values([
          { chatGroupId: 'group-a', agentId: 'agent-x', userId },
          { chatGroupId: 'group-a', agentId: 'agent-y', userId },
          { chatGroupId: 'group-b', agentId: 'agent-y', userId },
          { chatGroupId: 'group-c', agentId: 'agent-z', userId },
        ]);
      });

      const result = await chatGroupModel.getGroupsWithAgents(['agent-x', 'agent-y']);

      expect(result).toHaveLength(2);
      expect(result.map((g) => g.id)).toEqual(expect.arrayContaining(['group-a', 'group-b']));
    });

    it('should return all groups when no agentIds provided', async () => {
      await serverDB.insert(chatGroups).values([
        { id: 'all-group-1', userId, title: 'All Group 1' },
        { id: 'all-group-2', userId, title: 'All Group 2' },
      ]);

      const result = await chatGroupModel.getGroupsWithAgents();

      expect(result).toHaveLength(2);
    });

    it('should return empty array when no matching groups found', async () => {
      const result = await chatGroupModel.getGroupsWithAgents(['non-existent-agent']);
      expect(result).toEqual([]);
    });

    it('should only return groups for current user', async () => {
      // Create test data for multiple users
      await serverDB.transaction(async (trx) => {
        await trx.insert(chatGroups).values([
          { id: 'user-group', userId, title: 'User Group' },
          { id: 'other-user-group', userId: otherUserId, title: 'Other User Group' },
        ]);

        await trx.insert(agentsTable).values([
          { id: 'user-agent', userId, title: 'User Agent' },
          { id: 'other-agent', userId: otherUserId, title: 'Other Agent' },
        ]);

        await trx.insert(chatGroupsAgents).values([
          { chatGroupId: 'user-group', agentId: 'user-agent', userId },
          { chatGroupId: 'other-user-group', agentId: 'other-agent', userId: otherUserId },
        ]);
      });

      const result = await chatGroupModel.getGroupsWithAgents(['user-agent', 'other-agent']);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('user-group');
      expect(result[0].userId).toBe(userId);
    });
  });
});
