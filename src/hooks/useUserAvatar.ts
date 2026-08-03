import { DEFAULT_USER_AVATAR } from '@lobechat/const';

import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/selectors';

export const useUserAvatar = () => {
  return useUserStore(userProfileSelectors.userAvatar) || DEFAULT_USER_AVATAR;
};
