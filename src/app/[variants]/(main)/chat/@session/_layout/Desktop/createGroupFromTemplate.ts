import type { PartialDeep } from 'type-fest';

import type { GroupTemplate } from '@/components/ChatGroupWizard/templates';
import type { NewChatGroup } from '@/database/schemas/chatGroup';
import type { LobeAgentSession, LobeSession } from '@/types/session';

interface TemplateCreationScope {
  chatGroupGeneration: number;
  sessionGeneration: number;
  userScope: string;
}

interface CreateGroupFromTemplateParams {
  createGroup: (group: Omit<NewChatGroup, 'userId'>, agentIds?: string[]) => Promise<string>;
  createSession: (
    session?: PartialDeep<LobeAgentSession>,
    switchToSession?: boolean,
  ) => Promise<string>;
  getCurrentScope: () => TemplateCreationScope | undefined;
  getSessionById: (sessionId: string) => LobeSession | undefined;
  group: Omit<NewChatGroup, 'userId'>;
  groupDescription: string;
  members: GroupTemplate['members'];
  refreshSessions: () => Promise<void>;
}

export const createGroupFromTemplate = async ({
  createGroup,
  createSession,
  getCurrentScope,
  getSessionById,
  group,
  groupDescription,
  members,
  refreshSessions,
}: CreateGroupFromTemplateParams): Promise<string> => {
  const requestedScope = getCurrentScope();
  if (!requestedScope) return '';

  const isCurrentTemplateCreation = (): boolean => {
    const currentScope = getCurrentScope();

    return (
      currentScope?.userScope === requestedScope.userScope &&
      currentScope.sessionGeneration === requestedScope.sessionGeneration &&
      currentScope.chatGroupGeneration === requestedScope.chatGroupGeneration
    );
  };

  const memberAgentIds: string[] = [];
  for (const member of members) {
    if (!isCurrentTemplateCreation()) return '';

    const sessionId = await createSession(
      {
        config: {
          plugins: member.plugins,
          systemRole: member.systemRole,
          virtual: true,
        },
        meta: {
          avatar: member.avatar,
          backgroundColor: member.backgroundColor,
          description: `${member.title} - ${groupDescription}`,
          title: member.title,
        },
      },
      false,
    );
    if (!sessionId || !isCurrentTemplateCreation()) return '';

    await refreshSessions();
    if (!isCurrentTemplateCreation()) return '';

    const session = getSessionById(sessionId);
    if (!session || session.type !== 'agent') return '';

    const agentId = (session as LobeAgentSession).config?.id;
    if (!agentId || !isCurrentTemplateCreation()) return '';

    memberAgentIds.push(agentId);
  }

  if (!isCurrentTemplateCreation()) return '';

  const groupId = await createGroup(group, memberAgentIds);
  if (!groupId || !isCurrentTemplateCreation()) return '';

  return groupId;
};
