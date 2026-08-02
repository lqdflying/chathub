import type { ActionKeys } from './config';

export const GROUP_CHAT_LEFT_ACTIONS: ActionKeys[] = [
  'typo',
  'fileUpload',
  'knowledgeBase',
  'skills',
  '---',
  ['stt', 'clear'],
  'groupChatToken',
];

export const MOBILE_CHAT_LEFT_ACTIONS: ActionKeys[] = [
  'model',
  'search',
  'fileUpload',
  'knowledgeBase',
  'skills',
  'tools',
  'mainToken',
];
