import { getSingletonAnalyticsOptional } from '@lobehub/analytics';
import { useLayoutEffect } from 'react';
import useSWR, { SWRResponse, mutate } from 'swr';
import type { PartialDeep } from 'type-fest';
import type { StateCreator } from 'zustand/vanilla';

import { DEFAULT_PREFERENCE } from '@/const/user';
import { useOnlyFetchOnceSWR } from '@/libs/swr';
import { userService } from '@/services/user';
import type { UserStore } from '@/store/user';
import type { GlobalServerConfig } from '@/types/serverConfig';
import { LobeUser, UserInitializationState } from '@/types/user';
import type { UserSettings } from '@/types/user/settings';
import { merge } from '@/utils/merge';
import { setNamespace } from '@/utils/storeDebug';

import { authSelectors } from '../auth/selectors';
import { initialModelListState } from '../modelList/initialState';
import { preferenceSelectors } from '../preference/selectors';
import { initialSettingsState } from '../settings/initialState';
import { initialCommonState } from './initialState';

const n = setNamespace('common');

const GET_USER_STATE_KEY = 'initUserState';
const getUserStateKey = (userScope: string) => [GET_USER_STATE_KEY, userScope] as const;
const createResetUserState = () => ({
  ...initialCommonState,
  ...initialModelListState,
  ...initialSettingsState,
  preference: DEFAULT_PREFERENCE,
  user: undefined,
});
/**
 * 设置操作
 */
export interface CommonAction {
  refreshUserState: () => Promise<void>;
  updateAvatar: (avatar: string) => Promise<void>;
  useCheckTrace: (shouldFetch: boolean, userScope?: string) => SWRResponse;
  useInitUserState: (
    isLogin: boolean | undefined,
    userScope: string | undefined,
    serverConfig: GlobalServerConfig,
    options?: {
      onSuccess: (data: UserInitializationState) => void;
    },
  ) => SWRResponse;
}

export const createCommonSlice: StateCreator<
  UserStore,
  [['zustand/devtools', never]],
  [],
  CommonAction
> = (set, get) => ({
  refreshUserState: async () => {
    const userScope = authSelectors.currentUserScope(get());
    if (!userScope) return;

    const initializationFailure = get().userStateInitializationFailure;
    if (
      initializationFailure?.scope === userScope &&
      initializationFailure.reason === 'owner-mismatch'
    ) {
      return;
    }

    if (initializationFailure?.scope === userScope) {
      set({ userStateInitializationFailure: undefined }, false, n('refreshUserState/start'));
    }

    await mutate(getUserStateKey(userScope));
  },
  updateAvatar: async (avatar) => {
    // 1. 更新服务端/数据库中的头像
    await userService.updateAvatar(avatar);

    await get().refreshUserState();
  },

  useCheckTrace: (shouldFetch, userScope) =>
    useSWR<boolean>(
      shouldFetch && userScope ? ['checkTrace', userScope] : null,
      () => {
        const userAllowTrace = preferenceSelectors.userAllowTrace(get());

        // if user have set the trace, return false
        if (typeof userAllowTrace === 'boolean') return Promise.resolve(false);

        return Promise.resolve(get().isUserCanEnableTrace);
      },
      {
        revalidateOnFocus: false,
      },
    ),

  useInitUserState: (isLogin, userScope, serverConfig, options) => {
    useLayoutEffect(() => {
      const currentScope = get().userStateScope;
      const didUserScopeChange = currentScope !== userScope;
      if (!didUserScopeChange) return;

      set(
        createResetUserState(),
        false,
        n('resetUserStateScope'),
      );
    }, [isLogin, userScope]);

    return useOnlyFetchOnceSWR<UserInitializationState>(
      isLogin && userScope ? getUserStateKey(userScope) : null,
      () => userService.getUserState(),
      {
        onError: () => {
          const currentUserScope = authSelectors.currentUserScope(get());
          if (currentUserScope !== userScope) return;
          if (get().isUserStateInit && get().userStateScope === userScope) return;

          set(
            {
              userStateInitializationFailure: {
                reason: 'request-failed',
                scope: userScope,
              },
            },
            false,
            n('initUserState/error'),
          );
        },
        onSuccess: (data) => {
          const currentUserScope = authSelectors.currentUserScope(get());
          if (currentUserScope !== userScope) return;
          if (
            userScope !== 'local' &&
            (!data.authUserId || `user:${data.authUserId}` !== userScope)
          ) {
            set(
              {
                ...createResetUserState(),
                userStateInitializationFailure: {
                  reason: 'owner-mismatch',
                  scope: userScope,
                },
              },
              false,
              n('initUserState/ownerMismatch'),
            );
            return;
          }

          options?.onSuccess?.(data);

          if (data) {
            // merge settings
            const serverSettings: PartialDeep<UserSettings> = {
              defaultAgent: serverConfig.defaultAgent,
              image: serverConfig.image,
              languageModel: serverConfig.languageModel,
              systemAgent: serverConfig.systemAgent,
            };

            const defaultSettings = merge(get().defaultSettings, serverSettings);

            // merge preference
            const isEmpty = Object.keys(data.preference || {}).length === 0;
            const preference = isEmpty ? DEFAULT_PREFERENCE : data.preference;

            // if there is avatar or userId (from client DB), update it into user
            const user =
              data.avatar || data.userId
                ? merge(get().user, {
                    avatar: data.avatar,
                    email: data.email,
                    firstName: data.firstName,
                    fullName: data.fullName,
                    id: data.userId,
                    latestName: data.lastName,
                    username: data.username,
                  } as LobeUser)
                : get().user;

            set(
              {
                defaultSettings,
                isOnboard: data.isOnboard,
                isShowPWAGuide: data.canEnablePWAGuide,
                isUserCanEnableTrace: data.canEnableTrace,
                isUserHasConversation: data.hasConversation,
                isUserStateInit: true,
                preference,
                serverLanguageModel: serverConfig.languageModel,
                settings: data.settings || {},
                subscriptionPlan: data.subscriptionPlan,
                user,
                userStateInitializationFailure: undefined,
                userStateOwnerId: data.userId || get().user?.id,
                userStateScope: userScope,
              },
              false,
              n('initUserState'),
            );
            //analytics
            const analytics = getSingletonAnalyticsOptional();
            analytics?.identify(data.userId || '', {
              email: data.email,
              firstName: data.firstName,
              lastName: data.lastName,
              username: data.username,
            });
            get().refreshDefaultModelProviderList({ trigger: 'fetchUserState' });
          }
        },
      },
    );
  },
});
