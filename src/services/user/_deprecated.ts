import { MessageModel } from '@/database/_deprecated/models/message';
import { SessionModel } from '@/database/_deprecated/models/session';
import { UserModel } from '@/database/_deprecated/models/user';
import { UserInitializationState, UserPreference } from '@/types/user';
import { UserSettings } from '@/types/user/settings';
import { AsyncLocalStorage } from '@/utils/localStorage';

import { IUserService } from './type';

const throwIfAborted = (signal?: AbortSignal): void => {
  signal?.throwIfAborted();
};

export class ClientService implements IUserService {
  private preferenceStorage: AsyncLocalStorage<UserPreference>;

  constructor() {
    this.preferenceStorage = new AsyncLocalStorage('LOBE_PREFERENCE');
  }

  getUserRegistrationDuration = async () => {
    throw new Error('Method not implemented.');
  };

  async getUserState(): Promise<UserInitializationState> {
    const user = await UserModel.getUser();
    const messageCount = await MessageModel.count();
    const sessionCount = await SessionModel.count();

    return {
      avatar: user.avatar,
      canEnablePWAGuide: messageCount >= 4,
      canEnableTrace: messageCount >= 4,
      hasConversation: messageCount > 0 || sessionCount > 0,
      isOnboard: true,
      preference: await this.preferenceStorage.getFromLocalStorage(),
      settings: user.settings as UserSettings,
      userId: user.uuid,
    };
  }

  getUserSSOProviders = async () => {
    // Account not exist on next-auth in client mode, no need to implement this method
    return [];
  };

  unlinkSSOProvider = async () => {
    // Account not exist on next-auth in client mode, no need to implement this method
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  updateUserSettings: IUserService['updateUserSettings'] = async (patch, signal) => {
    throwIfAborted(signal);
    const result = await UserModel.updateSettings(patch);
    throwIfAborted(signal);

    return result;
  };

  resetUserSettings: IUserService['resetUserSettings'] = async (signal) => {
    throwIfAborted(signal);
    const result = await UserModel.resetSettings();
    throwIfAborted(signal);

    return result;
  };

  migrateImageConfig: IUserService['migrateImageConfig'] = async (imageConfig, signal) => {
    throwIfAborted(signal);
    const migrationResult = await this.preferenceStorage.updateLocalStorageAtomically(
      (currentPreference) => {
        throwIfAborted(signal);
        const existingImageConfig = currentPreference.imageConfig || {};
        if (Object.keys(existingImageConfig).length > 0) return;

        return { imageConfig };
      },
    );
    throwIfAborted(signal);

    return {
      imageConfig: migrationResult.state.imageConfig || {},
      migrated: migrationResult.updated,
    };
  };

  updateAvatar: IUserService['updateAvatar'] = async (avatar, signal) => {
    throwIfAborted(signal);
    await UserModel.updateAvatar(avatar);
    throwIfAborted(signal);
  };

  updatePreference: IUserService['updatePreference'] = async (preference, signal) => {
    throwIfAborted(signal);
    await this.preferenceStorage.saveToLocalStorage(preference);
    throwIfAborted(signal);
  };

  updateImageConfig: IUserService['updateImageConfig'] = async (imageConfig, signal) => {
    throwIfAborted(signal);
    await this.preferenceStorage.updateLocalStorage((preference) => {
      throwIfAborted(signal);

      return {
        imageConfig: { ...preference.imageConfig, ...imageConfig },
      };
    });
    throwIfAborted(signal);
  };

  updateGuide: IUserService['updateGuide'] = async (_guide, signal) => {
    throwIfAborted(signal);
    throw new Error('Method not implemented.');
  };
}
