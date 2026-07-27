import { clientDB } from '@/database/client/db';
import { MessageModel } from '@/database/models/message';
import { SessionModel } from '@/database/models/session';
import { UserModel } from '@/database/models/user';
import { users } from '@/database/schemas';
import { BaseClientService } from '@/services/baseClientService';
import { UserPreference } from '@/types/user';
import { AsyncLocalStorage } from '@/utils/localStorage';

import { IUserService } from './type';

const throwIfAborted = (signal?: AbortSignal): void => {
  signal?.throwIfAborted();
};

export class ClientService extends BaseClientService implements IUserService {
  private preferenceStorage: AsyncLocalStorage<UserPreference>;

  private get userModel(): UserModel {
    return new UserModel(clientDB as any, this.userId);
  }
  private get messageModel(): MessageModel {
    return new MessageModel(clientDB as any, this.userId);
  }
  private get sessionModel(): SessionModel {
    return new SessionModel(clientDB as any, this.userId);
  }

  constructor(userId?: string) {
    super(userId);
    this.preferenceStorage = new AsyncLocalStorage('LOBE_PREFERENCE');
  }

  getUserRegistrationDuration: IUserService['getUserRegistrationDuration'] = async () => {
    return this.userModel.getUserRegistrationDuration();
  };

  getUserState: IUserService['getUserState'] = async () => {
    // if user not exist in the db, create one to make sure the user exist
    await this.makeSureUserExist();

    const state = await this.userModel.getUserState((encryptKeyVaultsStr) =>
      encryptKeyVaultsStr ? JSON.parse(encryptKeyVaultsStr) : {},
    );

    const messageCount = await this.messageModel.count();
    const sessionCount = await this.sessionModel.count();

    return {
      ...state,
      avatar: state.avatar ?? '',
      canEnablePWAGuide: messageCount >= 4,
      canEnableTrace: messageCount >= 4,
      firstName: state.firstName,
      fullName: state.fullName,
      hasConversation: messageCount > 0 || sessionCount > 0,
      isOnboard: true,
      lastName: state.lastName,
      preference: await this.preferenceStorage.getFromLocalStorage(),
      username: state.username,
    };
  };

  getUserSSOProviders: IUserService['getUserSSOProviders'] = async () => {
    // Account not exist on next-auth in client mode, no need to implement this method
    return [];
  };

  unlinkSSOProvider: IUserService['unlinkSSOProvider'] = async () => {
    // Account not exist on next-auth in client mode, no need to implement this method
  };

  updateUserSettings: IUserService['updateUserSettings'] = async (value, signal) => {
    throwIfAborted(signal);
    const { keyVaults, ...res } = value;

    const result = await this.userModel.updateSetting({
      ...res,
      keyVaults: JSON.stringify(keyVaults),
    });
    throwIfAborted(signal);

    return result;
  };

  resetUserSettings: IUserService['resetUserSettings'] = async (signal) => {
    throwIfAborted(signal);
    const result = await this.userModel.deleteSetting();
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
    await this.userModel.updateUser({ avatar });
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

  makeSureUserExist = async () => {
    const existUsers = await clientDB.query.users.findMany();

    let user: { id: string };
    if (existUsers.length === 0) {
      const result = await clientDB.insert(users).values({ id: this.userId }).returning();
      user = result[0];
    } else {
      user = existUsers[0];
    }

    return user;
  };
}
