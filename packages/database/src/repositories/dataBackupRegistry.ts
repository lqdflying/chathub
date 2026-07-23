import { DataBackupTable } from '@/types/export';

import * as schema from '../schemas';

export type BackupIdStrategy = 'generated' | 'junction' | 'natural' | 'singleton';

export interface BackupRelation {
  deferred?: boolean;
  field: string;
  sourceTable: DataBackupTable;
}

export interface DataBackupTableConfig {
  conflictFields?: string[];
  idStrategy: BackupIdStrategy;
  relations?: BackupRelation[];
  table: DataBackupTable;
  userField: 'id' | 'userId';
}

/**
 * This is the canonical order for both backup and restore. A table must not be
 * added to export unless its restore behavior and dependencies are represented
 * here as well.
 */
export const DATA_BACKUP_REGISTRY: readonly DataBackupTableConfig[] = [
  { idStrategy: 'singleton', table: 'users', userField: 'id' },
  { idStrategy: 'singleton', table: 'userSettings', userField: 'id' },
  {
    conflictFields: ['identifier'],
    idStrategy: 'junction',
    table: 'userInstalledPlugins',
    userField: 'userId',
  },
  {
    conflictFields: ['id'],
    idStrategy: 'natural',
    table: 'aiProviders',
    userField: 'userId',
  },
  {
    conflictFields: ['id', 'providerId'],
    idStrategy: 'natural',
    relations: [{ field: 'providerId', sourceTable: 'aiProviders' }],
    table: 'aiModels',
    userField: 'userId',
  },
  { idStrategy: 'generated', table: 'userMemories', userField: 'userId' },
  {
    idStrategy: 'generated',
    table: 'userMemoriesContexts',
    userField: 'userId',
  },
  {
    idStrategy: 'generated',
    relations: [{ field: 'userMemoryId', sourceTable: 'userMemories' }],
    table: 'userMemoriesPreferences',
    userField: 'userId',
  },
  {
    idStrategy: 'generated',
    relations: [{ field: 'userMemoryId', sourceTable: 'userMemories' }],
    table: 'userMemoriesIdentities',
    userField: 'userId',
  },
  {
    idStrategy: 'generated',
    relations: [{ field: 'userMemoryId', sourceTable: 'userMemories' }],
    table: 'userMemoriesExperiences',
    userField: 'userId',
  },
  { idStrategy: 'generated', table: 'sessionGroups', userField: 'userId' },
  { idStrategy: 'generated', table: 'agents', userField: 'userId' },
  {
    idStrategy: 'generated',
    relations: [{ field: 'groupId', sourceTable: 'sessionGroups' }],
    table: 'sessions',
    userField: 'userId',
  },
  {
    idStrategy: 'generated',
    relations: [{ field: 'groupId', sourceTable: 'sessionGroups' }],
    table: 'chatGroups',
    userField: 'userId',
  },
  {
    idStrategy: 'generated',
    relations: [
      { field: 'sessionId', sourceTable: 'sessions' },
      { field: 'groupId', sourceTable: 'chatGroups' },
    ],
    table: 'topics',
    userField: 'userId',
  },
  {
    idStrategy: 'generated',
    relations: [
      { field: 'topicId', sourceTable: 'topics' },
      { deferred: true, field: 'parentThreadId', sourceTable: 'threads' },
      { deferred: true, field: 'sourceMessageId', sourceTable: 'messages' },
    ],
    table: 'threads',
    userField: 'userId',
  },
  {
    idStrategy: 'generated',
    relations: [
      { field: 'topicId', sourceTable: 'topics' },
      { deferred: true, field: 'parentGroupId', sourceTable: 'messageGroups' },
      { deferred: true, field: 'parentMessageId', sourceTable: 'messages' },
    ],
    table: 'messageGroups',
    userField: 'userId',
  },
  {
    idStrategy: 'generated',
    relations: [
      { field: 'sessionId', sourceTable: 'sessions' },
      { field: 'topicId', sourceTable: 'topics' },
      { field: 'threadId', sourceTable: 'threads' },
      { field: 'agentId', sourceTable: 'agents' },
      { field: 'groupId', sourceTable: 'chatGroups' },
      { field: 'messageGroupId', sourceTable: 'messageGroups' },
      { deferred: true, field: 'parentId', sourceTable: 'messages' },
      { deferred: true, field: 'quotaId', sourceTable: 'messages' },
    ],
    table: 'messages',
    userField: 'userId',
  },
  {
    conflictFields: ['agentId', 'sessionId'],
    idStrategy: 'junction',
    relations: [
      { field: 'agentId', sourceTable: 'agents' },
      { field: 'sessionId', sourceTable: 'sessions' },
    ],
    table: 'agentsToSessions',
    userField: 'userId',
  },
  {
    conflictFields: ['chatGroupId', 'agentId'],
    idStrategy: 'junction',
    relations: [
      { field: 'chatGroupId', sourceTable: 'chatGroups' },
      { field: 'agentId', sourceTable: 'agents' },
    ],
    table: 'chatGroupsAgents',
    userField: 'userId',
  },
  {
    conflictFields: ['id'],
    idStrategy: 'junction',
    relations: [{ field: 'id', sourceTable: 'messages' }],
    table: 'messagePlugins',
    userField: 'userId',
  },
  {
    conflictFields: ['id'],
    idStrategy: 'junction',
    relations: [{ field: 'id', sourceTable: 'messages' }],
    table: 'messageTranslates',
    userField: 'userId',
  },
] as const;

export const DATA_BACKUP_TABLE_OBJECTS = Object.fromEntries(
  DATA_BACKUP_REGISTRY.map(({ table }) => [table, schema[table]]),
) as Record<DataBackupTable, (typeof schema)[DataBackupTable]>;

export const DATA_BACKUP_TABLE_NAMES = DATA_BACKUP_REGISTRY.map(({ table }) => table);
