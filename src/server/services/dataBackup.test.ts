import { afterEach, describe, expect, it, vi } from 'vitest';

import migrations from '@/database/core/migrations.json';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import {
  CURRENT_DATA_BACKUP_FORMAT_VERSION,
  DataBackupV2,
  ImportPgDataStructure,
  getIgnoredBackupTables,
  parseDatabaseBackup,
} from '@/types/export';

import {
  DataBackupError,
  validateBackupSchemaCompatibility,
  validateBackupSecrets,
} from './dataBackup';

const latestSchemaHash = migrations.at(-1)!.hash;
const createV2Backup = (data: DataBackupV2['data'] = {}): DataBackupV2 => ({
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
    ...data,
  },
  exportedAt: '2026-01-02T03:04:05.000Z',
  formatVersion: CURRENT_DATA_BACKUP_FORMAT_VERSION,
  mode: 'postgres',
  schemaHash: latestSchemaHash,
  secretStrategy: 'deployment-keyed',
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('data backup validation', () => {
  it('accepts known older schemas but rejects newer and unknown schemas', () => {
    const olderBackup: ImportPgDataStructure = {
      data: {},
      mode: 'postgres',
      schemaHash: migrations[0].hash,
    };

    expect(() => validateBackupSchemaCompatibility(olderBackup, latestSchemaHash)).not.toThrow();
    expect(() =>
      validateBackupSchemaCompatibility(createV2Backup(), migrations[0].hash),
    ).toThrowError(expect.objectContaining({ code: 'SOURCE_SCHEMA_NEWER' }));
    expect(() =>
      validateBackupSchemaCompatibility(
        { ...olderBackup, schemaHash: 'unknown-source-hash' },
        latestSchemaHash,
      ),
    ).toThrowError(expect.objectContaining({ code: 'UNKNOWN_SCHEMA' }));
  });

  it('strictly validates v2 while retaining explicit v1 ignored-table compatibility', () => {
    expect(() => parseDatabaseBackup(null)).toThrow();
    expect(() =>
      parseDatabaseBackup({ ...createV2Backup(), formatVersion: 3 }),
    ).toThrow('Unsupported backup format version');
    expect(() =>
      parseDatabaseBackup(
        createV2Backup({
          unexpectedSecrets: [{ token: 'no' }],
        } as DataBackupV2['data']),
      ),
    ).toThrow('Unsupported backup table');
    const incompleteBackup = createV2Backup();
    delete incompleteBackup.data.messages;
    expect(() => parseDatabaseBackup(incompleteBackup)).toThrow(
      'Backup is incomplete: missing table messages',
    );

    const v1 = parseDatabaseBackup({
      data: { messageChunks: [{ chunkId: 'legacy-derived-row' }] },
      mode: 'postgres',
      schemaHash: latestSchemaHash,
    }).backup;
    expect(getIgnoredBackupTables(v1)).toEqual(['messageChunks']);
  });

  it('accepts authentic deployment-keyed vaults', async () => {
    const decrypt = vi.fn().mockResolvedValue({
      plaintext: JSON.stringify({ apiKey: 'secret' }),
      wasAuthentic: true,
    });
    vi.spyOn(KeyVaultsGateKeeper, 'initWithEnvKey').mockResolvedValue({
      decrypt,
    } as unknown as KeyVaultsGateKeeper);

    await expect(
      validateBackupSecrets(
        createV2Backup({
          aiProviders: [{ id: 'provider', keyVaults: 'encrypted-provider-vault' }],
          userSettings: [{ keyVaults: 'encrypted-user-vault' }],
        }),
      ),
    ).resolves.toBeUndefined();
    expect(decrypt).toHaveBeenCalledTimes(2);
  });

  it('blocks a credential key mismatch before import', async () => {
    vi.spyOn(KeyVaultsGateKeeper, 'initWithEnvKey').mockResolvedValue({
      decrypt: vi.fn().mockResolvedValue({ plaintext: '', wasAuthentic: false }),
    } as unknown as KeyVaultsGateKeeper);

    await expect(
      validateBackupSecrets(
        createV2Backup({
          aiProviders: [{ id: 'provider', keyVaults: 'encrypted-provider-vault' }],
        }),
      ),
    ).rejects.toEqual(
      expect.objectContaining<DataBackupError>({
        code: 'BACKUP_SECRET_MISMATCH',
      }),
    );
  });
});
