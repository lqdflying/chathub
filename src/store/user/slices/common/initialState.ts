import { Plans } from '@/types/subscription';

export interface CommonState {
  isOnboard: boolean;
  isShowPWAGuide: boolean;
  isUserCanEnableTrace: boolean;
  isUserHasConversation: boolean;
  isUserStateInit: boolean;
  subscriptionPlan?: Plans;
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
  userStateOwnerId: undefined,
  userStateScope: undefined,
};
