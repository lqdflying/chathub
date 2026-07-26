import type { PartialDeep } from 'type-fest';
import { Mock, beforeEach, describe, expect, it, vi } from 'vitest';

import { UserModel } from '@/database/_deprecated/models/user';
import { UserPreference } from '@/types/user';
import { UserSettings } from '@/types/user/settings';

import { ClientService } from './_deprecated';

vi.mock('@/database/_deprecated/models/user', () => ({
  UserModel: {
    getUser: vi.fn(),
    updateSettings: vi.fn(),
    resetSettings: vi.fn(),
    updateAvatar: vi.fn(),
  },
}));

const mockUser = {
  avatar: 'avatar.png',
  settings: { themeMode: 'light' } as unknown as UserSettings,
  uuid: 'user-id',
};

const mockPreference = {
  useCmdEnterToSend: true,
} as UserPreference;

describe('ClientService', () => {
  let clientService: ClientService;

  beforeEach(() => {
    vi.clearAllMocks();
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
    clientService = new ClientService();
  });

  it('should get user state correctly', async () => {
    (UserModel.getUser as Mock).mockResolvedValue(mockUser);
    const spyOn = vi
      .spyOn(clientService['preferenceStorage'], 'getFromLocalStorage')
      .mockResolvedValue(mockPreference);

    const userState = await clientService.getUserState();

    expect(userState).toEqual({
      avatar: mockUser.avatar,
      isOnboard: true,
      canEnablePWAGuide: false,
      hasConversation: false,
      canEnableTrace: false,
      preference: mockPreference,
      settings: mockUser.settings,
      userId: mockUser.uuid,
    });
    expect(UserModel.getUser).toHaveBeenCalledTimes(1);
    expect(spyOn).toHaveBeenCalledTimes(1);
  });

  it('should update user settings correctly', async () => {
    const settingsPatch: PartialDeep<UserSettings> = { general: { fontSize: 12 } };
    (UserModel.updateSettings as Mock).mockResolvedValue(undefined);

    await clientService.updateUserSettings(settingsPatch);

    expect(UserModel.updateSettings).toHaveBeenCalledWith(settingsPatch);
    expect(UserModel.updateSettings).toHaveBeenCalledTimes(1);
  });

  it('should reset user settings correctly', async () => {
    (UserModel.resetSettings as Mock).mockResolvedValue(undefined);

    await clientService.resetUserSettings();

    expect(UserModel.resetSettings).toHaveBeenCalledTimes(1);
  });

  it('should update user avatar correctly', async () => {
    const newAvatar = 'new-avatar.png';
    (UserModel.updateAvatar as Mock).mockResolvedValue(undefined);

    await clientService.updateAvatar(newAvatar);

    expect(UserModel.updateAvatar).toHaveBeenCalledWith(newAvatar);
    expect(UserModel.updateAvatar).toHaveBeenCalledTimes(1);
  });

  it('should update user preference correctly', async () => {
    const newPreference = {
      useCmdEnterToSend: false,
    } as UserPreference;

    const spyOn = vi
      .spyOn(clientService['preferenceStorage'], 'saveToLocalStorage')
      .mockResolvedValue(undefined);

    await clientService.updatePreference(newPreference);

    expect(spyOn).toHaveBeenCalledWith(newPreference);
    expect(spyOn).toHaveBeenCalledTimes(1);
  });

  it('should merge image config with existing local preferences', async () => {
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
});
