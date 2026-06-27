import Clear from './Clear';
import History from './History';
import Knowledge from './Knowledge';
import Mention from './Mention';
import Model from './Model';
import STT from './STT';
import SaveTopic from './SaveTopic';
import Search from './Search';
import { GroupChatToken, MainToken, PortalToken } from './Token';
import Tools from './Tools';
import Typo from './Typo';
import Upload from './Upload';

export const actionMap = {
  clear: Clear,
  fileUpload: Upload,
  groupChatToken: GroupChatToken,
  history: History,
  knowledgeBase: Knowledge,
  mainToken: MainToken,
  mention: Mention,
  model: Model,
  portalToken: PortalToken,
  saveTopic: SaveTopic,
  search: Search,
  stt: STT,
  tools: Tools,
  typo: Typo,
} as const;

export type ActionKey = keyof typeof actionMap;

export type ActionKeys = ActionKey | ActionKey[] | '---';
