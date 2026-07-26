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
  ) => Promise<UserImageGenerationConfigMigrationResult>;
  resetUserSettings: () => Promise<any>;
  unlinkSSOProvider: (provider: string, providerAccountId: string) => Promise<any>;
  updateAvatar: (avatar: string) => Promise<any>;
  updateGuide: (guide: Partial<UserGuide>) => Promise<any>;
  updateImageConfig: (imageConfig: Partial<UserImageGenerationConfig>) => Promise<any>;
  updatePreference: (preference: Partial<UserPreference>) => Promise<any>;
  updateUserSettings: (value: PartialDeep<UserSettings>, signal?: AbortSignal) => Promise<any>;
}
