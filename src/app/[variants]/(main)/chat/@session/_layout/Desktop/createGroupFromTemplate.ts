import type { PartialDeep } from 'type-fest';

import type { GroupTemplate } from '@/components/ChatGroupWizard/templates';
import type { CreateChatGroupMemberSession } from '@/database/models/chatGroup';
import type { NewChatGroup } from '@/database/schemas/chatGroup';
import { normalizeAgentSession } from '@/services/session/normalizeSession';
import { prepareAgentSession } from '@/store/session/slices/session/prepareAgentSession';
import type { LobeAgentSession } from '@/types/session';

interface TemplateCreationScope {
  chatGroupGeneration: number;
  sessionGeneration: number;
  userScope: string;
}

interface CreateGroupFromTemplateParams {
  createGroup: (
    group: Omit<NewChatGroup, 'userId'>,
    agentIds?: string[],
    silent?: boolean,
    virtualSessions?: CreateChatGroupMemberSession[],
  ) => Promise<string>;
  defaultAgentSettings?: PartialDeep<LobeAgentSession>;
  getCurrentScope: () => TemplateCreationScope | undefined;
  group: Omit<NewChatGroup, 'userId'>;
  groupDescription: string;
  members: GroupTemplate['members'];
}

export const createGroupFromTemplate = async ({
  createGroup,
  defaultAgentSettings,
  getCurrentScope,
  group,
  groupDescription,
  members,
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

  const virtualSessions = members.map((member) => {
    const preparedSession = prepareAgentSession(
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
      defaultAgentSettings,
    );

    return normalizeAgentSession(preparedSession);
  });

  if (!isCurrentTemplateCreation()) return '';

  const groupId = await createGroup(group, undefined, false, virtualSessions);
  if (!groupId || !isCurrentTemplateCreation()) return '';

  return groupId;
};
