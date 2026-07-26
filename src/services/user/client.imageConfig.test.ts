import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ClientService } from './client';

describe('ClientService image config', () => {
  beforeEach(() => {
    localStorage.clear();
    let lockQueue = Promise.resolve<unknown>(undefined);
    vi.stubGlobal('navigator', {
      locks: {
        request: <Result>(_name: string, operation: () => Promise<Result>) => {
          const lockRequest = lockQueue.catch(() => undefined).then(operation);
          lockQueue = lockRequest;
          return lockRequest;
        },
      },
    });
  });

  it('preserves an existing image config during legacy migration', async () => {
    const clientService = new ClientService('user-id');
    const existingImageConfig = {
      imageNum: 8,
      model: 'newer-model',
      provider: 'newer-provider',
    };
    localStorage.setItem('LOBE_PREFERENCE', JSON.stringify({ imageConfig: existingImageConfig }));

    const result = await clientService.migrateImageConfig({
      imageNum: 4,
      model: 'legacy-model',
      provider: 'legacy-provider',
    });

    expect(result).toEqual({ imageConfig: existingImageConfig, migrated: false });
    expect(JSON.parse(localStorage.getItem('LOBE_PREFERENCE') || '{}').imageConfig).toEqual(
      existingImageConfig,
    );
  });

  it('merges image config with existing local preferences', async () => {
    const clientService = new ClientService('user-id');
    localStorage.setItem(
      'LOBE_PREFERENCE',
      JSON.stringify({
        imageConfig: {
          imageNum: 4,
          model: 'size-model',
          provider: 'custom-provider',
        },
        telemetry: true,
      }),
    );

    await clientService.updateImageConfig({ imageNum: 8, size: '1536x1024' });

    expect(JSON.parse(localStorage.getItem('LOBE_PREFERENCE') || '{}')).toEqual({
      imageConfig: {
        imageNum: 8,
        model: 'size-model',
        provider: 'custom-provider',
        size: '1536x1024',
      },
      telemetry: true,
    });
  });

  it('serializes migration with a newer concurrent image config update', async () => {
    const clientService = new ClientService('user-id');

    const migration = clientService.migrateImageConfig({
      imageNum: 4,
      model: 'legacy-model',
      provider: 'legacy-provider',
    });
    const newerUpdate = clientService.updateImageConfig({
      imageNum: 8,
      model: 'newer-model',
      provider: 'newer-provider',
    });

    await Promise.all([migration, newerUpdate]);

    const preference = JSON.parse(localStorage.getItem('LOBE_PREFERENCE') || '{}');
    expect(preference.imageConfig).toEqual({
      imageNum: 8,
      model: 'newer-model',
      provider: 'newer-provider',
    });
  });

  it('does not overwrite a newer image update that starts before migration', async () => {
    const clientService = new ClientService('user-id');

    const newerUpdate = clientService.updateImageConfig({
      imageNum: 8,
      model: 'newer-model',
      provider: 'newer-provider',
    });
    const migration = clientService.migrateImageConfig({
      imageNum: 4,
      model: 'legacy-model',
      provider: 'legacy-provider',
    });

    const [, migrationResult] = await Promise.all([newerUpdate, migration]);

    expect(migrationResult).toEqual({
      imageConfig: {
        imageNum: 8,
        model: 'newer-model',
        provider: 'newer-provider',
      },
      migrated: false,
    });
  });

  it('skips migration when cross-tab locking is unavailable', async () => {
    vi.stubGlobal('navigator', {});
    const clientService = new ClientService('user-id');

    const result = await clientService.migrateImageConfig({
      imageNum: 4,
      model: 'legacy-model',
      provider: 'legacy-provider',
    });

    expect(result).toEqual({ imageConfig: {}, migrated: false });
    expect(localStorage.getItem('LOBE_PREFERENCE')).toBeNull();
  });
});
