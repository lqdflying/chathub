import { beforeEach, describe, expect, it, vi } from 'vitest';

import migrations from '@/database/core/migrations.json';

import { parseConfigFile } from './config';

const { mockNotificationError } = vi.hoisted(() => ({
  mockNotificationError: vi.fn(),
}));

vi.mock('@/components/AntdStaticMethods', () => ({
  notification: { error: mockNotificationError },
}));
vi.mock('i18next', () => ({
  t: (key: string) => key,
}));

const createFile = (value: unknown) =>
  ({ text: vi.fn().mockResolvedValue(JSON.stringify(value)) }) as unknown as File;

describe('parseConfigFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('classifies and validates a v2 database backup', async () => {
    const backup = {
      appVersion: '1.0.15',
      data: {
        agents: [],
        agentsToSessions: [],
        aiModels: [],
        aiProviders: [],
        chatGroups: [],
        chatGroupsAgents: [],
        messageGroups: [],
        messagePlugins: [],
        messages: [],
        messageTranslates: [],
        sessionGroups: [],
        sessions: [],
        threads: [],
        topics: [],
        userInstalledPlugins: [],
        userInstalledSkills: [],
        userMemories: [],
        userMemoriesContexts: [],
        userMemoriesExperiences: [],
        userMemoriesIdentities: [],
        userMemoriesPreferences: [],
        users: [{}],
        userSettings: [],
      },
      exportedAt: '2026-01-02T03:04:05.000Z',
      formatVersion: 2,
      mode: 'postgres',
      schemaHash: migrations.at(-1)!.hash,
      secretStrategy: 'deployment-keyed',
    };

    await expect(parseConfigFile(createFile(backup))).resolves.toEqual(backup);
    expect(mockNotificationError).not.toHaveBeenCalled();
  });

  it('accepts legacy config files without using unsafe property checks', async () => {
    const config = {
      exportType: 'all',
      state: { settings: {} },
      version: 1,
    };

    await expect(parseConfigFile(createFile(config))).resolves.toEqual(config);
  });

  it.each([null, [], 'text', 42])('rejects malformed top-level JSON value %j', async (value) => {
    await expect(parseConfigFile(createFile(value))).resolves.toBeUndefined();
    expect(mockNotificationError).toHaveBeenCalledOnce();
  });

  it('rejects future backup formats before preview', async () => {
    const backup = {
      appVersion: 'future',
      data: {},
      exportedAt: '2026-01-02T03:04:05.000Z',
      formatVersion: 999,
      mode: 'postgres',
      schemaHash: migrations.at(-1)!.hash,
      secretStrategy: 'deployment-keyed',
    };

    await expect(parseConfigFile(createFile(backup))).resolves.toBeUndefined();
    expect(mockNotificationError).toHaveBeenCalledOnce();
  });
});
