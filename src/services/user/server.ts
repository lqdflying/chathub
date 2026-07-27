import { lambdaClient } from '@/libs/trpc/client';
import { IUserService } from '@/services/user/type';

export class ServerService implements IUserService {
  getUserRegistrationDuration: IUserService['getUserRegistrationDuration'] = async () => {
    return lambdaClient.user.getUserRegistrationDuration.query();
  };

  getUserState: IUserService['getUserState'] = async () => {
    return lambdaClient.user.getUserState.query();
  };

  getUserSSOProviders: IUserService['getUserSSOProviders'] = async () => {
    return lambdaClient.user.getUserSSOProviders.query();
  };

  unlinkSSOProvider: IUserService['unlinkSSOProvider'] = async (
    provider: string,
    providerAccountId: string,
    signal,
  ) => {
    const input = { provider, providerAccountId };
    if (!signal) return lambdaClient.user.unlinkSSOProvider.mutate(input);

    return lambdaClient.user.unlinkSSOProvider.mutate(input, { signal });
  };

  makeUserOnboarded = async () => {
    return lambdaClient.user.makeUserOnboarded.mutate();
  };

  migrateImageConfig: IUserService['migrateImageConfig'] = async (imageConfig, signal) => {
    if (!signal) return lambdaClient.user.migrateImageConfig.mutate(imageConfig);

    return lambdaClient.user.migrateImageConfig.mutate(imageConfig, { signal });
  };

  updateAvatar: IUserService['updateAvatar'] = async (avatar, signal) => {
    if (!signal) return lambdaClient.user.updateAvatar.mutate(avatar);

    return lambdaClient.user.updateAvatar.mutate(avatar, { signal });
  };

  updatePreference: IUserService['updatePreference'] = async (preference, signal) => {
    if (!signal) return lambdaClient.user.updatePreference.mutate(preference);

    return lambdaClient.user.updatePreference.mutate(preference, { signal });
  };

  updateGuide: IUserService['updateGuide'] = async (guide, signal) => {
    if (!signal) return lambdaClient.user.updateGuide.mutate(guide);

    return lambdaClient.user.updateGuide.mutate(guide, { signal });
  };

  updateImageConfig: IUserService['updateImageConfig'] = async (imageConfig, signal) => {
    if (!signal) return lambdaClient.user.updateImageConfig.mutate(imageConfig);

    return lambdaClient.user.updateImageConfig.mutate(imageConfig, { signal });
  };

  updateUserSettings: IUserService['updateUserSettings'] = async (value, signal) => {
    return lambdaClient.user.updateSettings.mutate(value, { signal });
  };

  resetUserSettings: IUserService['resetUserSettings'] = async (signal) => {
    if (!signal) return lambdaClient.user.resetSettings.mutate();

    return lambdaClient.user.resetSettings.mutate(undefined, { signal });
  };
}
