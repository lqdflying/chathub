import type { AdapterAccount } from 'next-auth/adapters';
import type { PartialDeep } from 'type-fest';

import {
  UserGuide,
  UserImageGenerationConfig,
  UserImageGenerationConfigMigrationResult,
  UserInitializationState,
  UserPreference,
} from '@/types/user';
import { UserSettings } from '@/types/user/settings';

export interface IUserService {
  getUserRegistrationDuration: () => Promise<{
    createdAt: string;
    duration: number;
    updatedAt: string;
  }>;
  getUserSSOProviders: () => Promise<AdapterAccount[]>;
  getUserState: () => Promise<UserInitializationState>;
  migrateImageConfig: (
    imageConfig: UserImageGenerationConfig,
    signal?: AbortSignal,
  ) => Promise<UserImageGenerationConfigMigrationResult>;
  resetUserSettings: (signal?: AbortSignal) => Promise<any>;
  unlinkSSOProvider: (
    provider: string,
    providerAccountId: string,
    signal?: AbortSignal,
  ) => Promise<any>;
  updateAvatar: (avatar: string, signal?: AbortSignal) => Promise<any>;
  updateGuide: (guide: Partial<UserGuide>, signal?: AbortSignal) => Promise<any>;
  updateImageConfig: (
    imageConfig: Partial<UserImageGenerationConfig>,
    signal?: AbortSignal,
  ) => Promise<any>;
  updatePreference: (preference: Partial<UserPreference>, signal?: AbortSignal) => Promise<any>;
  updateUserSettings: (value: PartialDeep<UserSettings>, signal?: AbortSignal) => Promise<any>;
}
