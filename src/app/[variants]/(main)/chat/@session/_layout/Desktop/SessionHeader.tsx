'use client';

import { ActionIcon, Dropdown, Icon } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { Bot, MessageSquarePlus, SquarePlus, Users } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { ProductLogo } from '@/components/Branding';
import { ChatGroupWizard } from '@/components/ChatGroupWizard';
import { useGroupTemplates } from '@/components/ChatGroupWizard/templates';
import { DESKTOP_HEADER_ICON_SIZE } from '@/const/layoutTokens';
import { DEFAULT_CHAT_GROUP_CHAT_CONFIG } from '@/const/settings';
import { useActionSWR } from '@/libs/swr';
import { useChatGroupStore } from '@/store/chatGroup';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useSessionStore } from '@/store/session';
import { useUserStore } from '@/store/user';
import { authSelectors, settingsSelectors } from '@/store/user/selectors';

import TogglePanelButton from '../../../features/TogglePanelButton';
import SessionSearchBar from '../../features/SessionSearchBar';
import { createGroupFromTemplate } from './createGroupFromTemplate';

export const useStyles = createStyles(({ css, token }) => ({
  logo: css`
    color: ${token.colorText};
    fill: ${token.colorText};
  `,
  top: css`
    position: sticky;
    z-index: 2;
    inset-block-start: 0;

    padding-block: 10px 8px;
    border-block-end: 1px solid ${token.colorBorderSecondary};

    background: ${token.colorBgLayout};
  `,
}));

const Header = memo(() => {
  const { styles } = useStyles();
  const { t } = useTranslation('chat');
  const groupTemplates = useGroupTemplates();
  const [createSession] = useSessionStore((s) => [s.createSession]);
  const [createGroup] = useChatGroupStore((s) => [s.createGroup]);
  const { showCreateSession, enableGroupChat } = useServerConfigStore(featureFlagsSelectors);
  const [isGroupWizardOpen, setIsGroupWizardOpen] = useState(false);

  // const enableGroupChatInLabs = useUserStore(preferenceSelectors.enableGroupChat);

  // We need pass inital member list so we cannot use mutate
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);

  const { mutate: mutateAgent, isValidating: isValidatingAgent } = useActionSWR(
    'session.createSession',
    () => createSession(),
  );

  const handleCreateGroupFromTemplate = async (
    templateId: string,
    hostConfig?: { model?: string; provider?: string },
    enableSupervisor?: boolean,
    selectedMemberTitles?: string[],
  ) => {
    // Don't close the modal immediately, keep it open during the process
    setIsCreatingGroup(true);
    try {
      const template = groupTemplates.find((t) => t.id === templateId);
      if (!template) {
        throw new Error(`Template ${templateId} not found`);
      }

      // Determine which members to create based on selection
      const membersToCreate =
        typeof selectedMemberTitles === 'undefined'
          ? template.members
          : template.members.filter((m) => selectedMemberTitles.includes(m.title));

      const groupId = await createGroupFromTemplate({
        createGroup,
        defaultAgentSettings: settingsSelectors.defaultAgent(useUserStore.getState()),
        getCurrentScope: () => {
          const userScope = authSelectors.currentUserScope(useUserStore.getState());
          if (!userScope) return;

          return {
            chatGroupGeneration: useChatGroupStore.getState().scopeGeneration,
            sessionGeneration: useSessionStore.getState().scopeGeneration,
            userScope,
          };
        },
        group: {
          config: {
            ...(hostConfig
              ? {
                  orchestratorModel: hostConfig.model,
                  orchestratorProvider: hostConfig.provider,
                }
              : {}),
            enableSupervisor: enableSupervisor ?? true,
            scene: DEFAULT_CHAT_GROUP_CHAT_CONFIG.scene,
          },
          title: template.title,
        },
        groupDescription: template.description,
        members: membersToCreate,
      });
      if (!groupId) return;

      // Close the modal only after all requests are finished successfully
      setIsGroupWizardOpen(false);
    } catch (error) {
      console.error('Failed to create group from template:', error);
      // Keep modal open on error so user can try again
    } finally {
      setIsCreatingGroup(false);
    }
  };

  const handleCreateGroupWithMembers = async (
    selectedAgents: string[],
    hostConfig?: { model?: string; provider?: string },
    enableSupervisor?: boolean,
  ) => {
    // Don't close modal immediately for custom group creation either
    setIsCreatingGroup(true);
    try {
      console.log('Creating custom group with hostConfig:', hostConfig);
      console.log(
        'Mapped config:',
        hostConfig
          ? {
              orchestratorModel: hostConfig.model,
              orchestratorProvider: hostConfig.provider,
            }
          : undefined,
      );

      await createGroup(
        {
          config: {
            ...(hostConfig
              ? {
                  orchestratorModel: hostConfig.model,
                  orchestratorProvider: hostConfig.provider,
                }
              : {}),
            enableSupervisor: enableSupervisor ?? true,
            scene: DEFAULT_CHAT_GROUP_CHAT_CONFIG.scene,
          },
          title: t('defaultGroupChat'),
        },
        selectedAgents,
      );
      // Close modal only after successful creation
      setIsGroupWizardOpen(false);
    } catch (error) {
      console.error('Failed to create group:', error);
      // Keep modal open on error
    } finally {
      setIsCreatingGroup(false);
    }
  };

  const handleGroupWizardCancel = () => {
    setIsGroupWizardOpen(false);
  };

  return (
    <Flexbox className={styles.top} gap={10} paddingInline={8}>
      <Flexbox align={'flex-start'} horizontal justify={'space-between'}>
        <Flexbox
          align={'center'}
          gap={4}
          horizontal
          style={{
            paddingInlineStart: 4,
            paddingTop: 1,
          }}
        >
          <ProductLogo className={styles.logo} size={32} type={'text'} />
        </Flexbox>
        <Flexbox align={'center'} gap={4} horizontal>
          <TogglePanelButton />
          {showCreateSession &&
            (enableGroupChat ? (
              <Dropdown
                menu={{
                  items: [
                    {
                      icon: <Icon icon={Bot} />,
                      key: 'newAgent',
                      label: t('newAgent'),
                      onClick: () => {
                        mutateAgent();
                      },
                    },
                    {
                      icon: <Icon icon={Users} />,
                      key: 'newGroup',
                      label: t('newGroupChat'),
                      onClick: () => {
                        setIsGroupWizardOpen(true);
                      },
                    },
                  ],
                }}
                trigger={['hover']}
              >
                <ActionIcon
                  icon={SquarePlus}
                  loading={isValidatingAgent || isCreatingGroup}
                  size={DESKTOP_HEADER_ICON_SIZE}
                  style={{ flex: 'none' }}
                />
              </Dropdown>
            ) : (
              <ActionIcon
                icon={MessageSquarePlus}
                loading={isValidatingAgent}
                onClick={() => mutateAgent()}
                size={DESKTOP_HEADER_ICON_SIZE}
                style={{ flex: 'none' }}
                title={t('newAgent')}
                tooltipProps={{
                  placement: 'bottom',
                }}
              />
            ))}
        </Flexbox>
      </Flexbox>
      <SessionSearchBar />

      {enableGroupChat && (
        <ChatGroupWizard
          isCreatingFromTemplate={isCreatingGroup}
          onCancel={handleGroupWizardCancel}
          onCreateCustom={handleCreateGroupWithMembers}
          onCreateFromTemplate={handleCreateGroupFromTemplate}
          open={isGroupWizardOpen}
        />
      )}
    </Flexbox>
  );
});

export default Header;
