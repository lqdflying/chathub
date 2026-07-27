import { Plans } from '@/types/subscription';

export type UserStateInitializationFailureReason = 'owner-mismatch' | 'request-failed';

export interface UserStateInitializationFailure {
  reason: UserStateInitializationFailureReason;
  scope: string;
}

export interface CommonState {
  isOnboard: boolean;
  isShowPWAGuide: boolean;
  isUserCanEnableTrace: boolean;
  isUserHasConversation: boolean;
  isUserStateInit: boolean;
  subscriptionPlan?: Plans;
  userStateInitializationFailure?: UserStateInitializationFailure;
  userStateOwnerId?: string;
  userStateScope?: string;
}

export const initialCommonState: CommonState = {
  isOnboard: false,
  isShowPWAGuide: false,
  isUserCanEnableTrace: false,
  isUserHasConversation: false,
  isUserStateInit: false,
  subscriptionPlan: undefined,
  userStateInitializationFailure: undefined,
  userStateOwnerId: undefined,
  userStateScope: undefined,
};
