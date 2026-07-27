import { DEFAULT_SETTINGS } from '@lobechat/const';
import { UserSettings } from '@lobechat/types';
import type { PartialDeep } from 'type-fest';

export interface UserSettingsState {
  defaultSettings: UserSettings;
  settings: PartialDeep<UserSettings>;
  updateSettingsSignal?: AbortController;
  userMutationAbortControllers: AbortController[];
}

export const initialSettingsState: UserSettingsState = {
  defaultSettings: DEFAULT_SETTINGS,
  settings: {},
  updateSettingsSignal: undefined,
  userMutationAbortControllers: [],
};
