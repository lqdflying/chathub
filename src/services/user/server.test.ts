import type { PartialDeep } from 'type-fest';
import { describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';
import { UserInitializationState, UserPreference } from '@/types/user';
import { UserSettings } from '@/types/user/settings';

import { ServerService } from './server';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    user: {
      getUserRegistrationDuration: {
        query: vi.fn(),
      },
      getUserState: {
        query: vi.fn(),
      },
      getUserSSOProviders: {
        query: vi.fn(),
      },
      unlinkSSOProvider: {
        mutate: vi.fn(),
      },
      makeUserOnboarded: {
        mutate: vi.fn(),
      },
      migrateImageConfig: {
        mutate: vi.fn(),
      },
      updatePreference: {
        mutate: vi.fn(),
      },
      updateGuide: {
        mutate: vi.fn(),
      },
      updateImageConfig: {
        mutate: vi.fn(),
      },
      updateSettings: {
        mutate: vi.fn(),
      },
      resetSettings: {
        mutate: vi.fn(),
      },
    },
  },
}));

describe('ServerService', () => {
  const service = new ServerService();

  it('should get user registration duration', async () => {
    const mockData = {
      createdAt: '2023-01-01',
      duration: 100,
      updatedAt: '2023-01-02',
    };
    vi.mocked(lambdaClient.user.getUserRegistrationDuration.query).mockResolvedValue(mockData);

    const result = await service.getUserRegistrationDuration();
    expect(result).toEqual(mockData);
  });

  it('should get user state', async () => {
    const mockState: UserInitializationState = {
      isOnboard: true,
      preference: {
        telemetry: true,
      },
      settings: {},
    };
    vi.mocked(lambdaClient.user.getUserState.query).mockResolvedValue(mockState);

    const result = await service.getUserState();
    expect(result).toEqual(mockState);
  });

  it('should get user SSO providers', async () => {
    const mockProviders = [
      {
        provider: 'google',
        providerAccountId: '123',
        userId: 'user1',
        type: 'oauth' as const,
        access_token: 'token',
        token_type: 'bearer' as const,
        expires_at: 123,
        scope: 'email profile',
      },
    ];
    vi.mocked(lambdaClient.user.getUserSSOProviders.query).mockResolvedValue(mockProviders);

    const result = await service.getUserSSOProviders();
    expect(result).toEqual(mockProviders);
  });

  it('should unlink SSO provider', async () => {
    const provider = 'google';
    const providerAccountId = '123';
    await service.unlinkSSOProvider(provider, providerAccountId);

    expect(lambdaClient.user.unlinkSSOProvider.mutate).toHaveBeenCalledWith({
      provider,
      providerAccountId,
    });
  });

  it('should make user onboarded', async () => {
    await service.makeUserOnboarded();
    expect(lambdaClient.user.makeUserOnboarded.mutate).toHaveBeenCalled();
  });

  it('should migrate image config', async () => {
    const imageConfig = {
      imageNum: 8,
      model: 'size-model',
      provider: 'custom-provider',
      size: '1536x1024',
    };
    const migrationResult = { imageConfig, migrated: true };
    vi.mocked(lambdaClient.user.migrateImageConfig.mutate).mockResolvedValue(migrationResult);

    const result = await service.migrateImageConfig(imageConfig);

    expect(result).toEqual(migrationResult);
    expect(lambdaClient.user.migrateImageConfig.mutate).toHaveBeenCalledWith(imageConfig);
  });

  it('should update user preference', async () => {
    const preference: Partial<UserPreference> = {
      telemetry: true,
      useCmdEnterToSend: true,
    };
    await service.updatePreference(preference);
    expect(lambdaClient.user.updatePreference.mutate).toHaveBeenCalledWith(preference);
  });

  it('should forward cancellation signals to user mutations', async () => {
    const signal = new AbortController().signal;
    const preference: Partial<UserPreference> = {
      telemetry: true,
    };

    await service.updatePreference(preference, signal);
    await service.updateImageConfig({ imageNum: 4 }, signal);
    await service.resetUserSettings(signal);

    expect(lambdaClient.user.updatePreference.mutate).toHaveBeenCalledWith(preference, {
      signal,
    });
    expect(lambdaClient.user.updateImageConfig.mutate).toHaveBeenCalledWith(
      { imageNum: 4 },
      { signal },
    );
    expect(lambdaClient.user.resetSettings.mutate).toHaveBeenCalledWith(undefined, {
      signal,
    });
  });

  it('should update user guide', async () => {
    const guide = {
      moveSettingsToAvatar: true,
      topic: false,
      uploadFileInKnowledgeBase: true,
    };
    await service.updateGuide(guide);
    expect(lambdaClient.user.updateGuide.mutate).toHaveBeenCalledWith(guide);
  });

  it('should update image config', async () => {
    const imageConfig = {
      imageNum: 8,
      model: 'size-model',
      provider: 'custom-provider',
      size: '1536x1024',
    };
    await service.updateImageConfig(imageConfig);
    expect(lambdaClient.user.updateImageConfig.mutate).toHaveBeenCalledWith(imageConfig);
  });

  it('should update user settings', async () => {
    const settings: PartialDeep<UserSettings> = {
      defaultAgent: {
        config: {
          model: 'gpt-4',
          provider: 'openai',
        },
        meta: {
          avatar: 'avatar',
          description: 'test agent',
        },
      },
    };
    const signal = new AbortController().signal;
    await service.updateUserSettings(settings, signal);
    expect(lambdaClient.user.updateSettings.mutate).toHaveBeenCalledWith(settings, { signal });
  });

  it('should reset user settings', async () => {
    await service.resetUserSettings();
    expect(lambdaClient.user.resetSettings.mutate).toHaveBeenCalled();
  });
});
