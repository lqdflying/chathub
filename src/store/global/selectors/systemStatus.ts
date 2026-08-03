import { GlobalState, INITIAL_STATUS } from '../initialState';

export const systemStatus = (s: GlobalState) => s.status;

const sessionGroupKeys = (s: GlobalState): string[] =>
  s.status.expandSessionGroupKeys || INITIAL_STATUS.expandSessionGroupKeys;

const mobileShowTopic = (s: GlobalState) => s.status.mobileShowTopic;
const mobileShowPortal = (s: GlobalState) => s.status.mobileShowPortal;
const showChatSideBar = (s: GlobalState) => !s.status.zenMode && s.status.showChatSideBar;
const showSessionPanel = (s: GlobalState) => !s.status.zenMode && s.status.showSessionPanel;
const showFilePanel = (s: GlobalState) => s.status.showFilePanel;
const showImagePanel = (s: GlobalState) => s.status.showImagePanel;
const showImageTopicPanel = (s: GlobalState) => s.status.showImageTopicPanel;
const hidePWAInstaller = (s: GlobalState) => s.status.hidePWAInstaller;
const isShowCredit = (s: GlobalState) => s.status.isShowCredit;
const themeMode = (s: GlobalState) => s.status.themeMode || 'auto';
const language = (s: GlobalState) => s.status.language || 'auto';

const showChatHeader = (s: GlobalState) => !s.status.zenMode;
const inZenMode = (s: GlobalState) => s.status.zenMode;
const sessionWidth = (s: GlobalState) => s.status.sessionsWidth;
const portalWidth = (s: GlobalState) => s.status.portalWidth || 400;
const filePanelWidth = (s: GlobalState) => s.status.filePanelWidth;
const imagePanelWidth = (s: GlobalState) => s.status.imagePanelWidth;
const imageTopicPanelWidth = (s: GlobalState) => s.status.imageTopicPanelWidth;
const wideScreen = (s: GlobalState) => !s.status.noWideScreen;
const chatInputHeight = (s: GlobalState) => s.status.chatInputHeight || 64;
const expandInputActionbar = (s: GlobalState) => s.status.expandInputActionbar;
const isStatusInit = (s: GlobalState) => !!s.isStatusInit;
const isDBInited = (): boolean => true;

const getAgentSystemRoleExpanded =
  (agentId: string) =>
  (s: GlobalState): boolean => {
    const map = s.status.systemRoleExpandedMap || {};
    return map[agentId] !== false; // 角色设定默认为展开状态
  };

export const systemStatusSelectors = {
  chatInputHeight,
  expandInputActionbar,
  filePanelWidth,
  getAgentSystemRoleExpanded,
  hidePWAInstaller,
  imagePanelWidth,
  imageTopicPanelWidth,
  inZenMode,
  isDBInited,
  isShowCredit,
  isStatusInit,
  language,
  mobileShowPortal,
  mobileShowTopic,
  portalWidth,
  sessionGroupKeys,
  sessionWidth,
  showChatHeader,
  showChatSideBar,
  showFilePanel,
  showImagePanel,
  showImageTopicPanel,
  showSessionPanel,
  systemStatus,
  themeMode,
  wideScreen,
};
