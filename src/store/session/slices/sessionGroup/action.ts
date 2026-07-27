import { t } from 'i18next';
import { StateCreator } from 'zustand/vanilla';

import { message } from '@/components/AntdStaticMethods';
import { sessionService } from '@/services/session';
import {
  captureAccountMutationSnapshot,
  isAccountMutationCurrent,
  type AccountMutationSnapshot,
} from '@/store/accountMutation';
import { SessionStore } from '@/store/session';
import { useUserStore } from '@/store/user';
import { SessionGroupItem } from '@/types/session';

import { SessionGroupsDispatch, sessionGroupsReducer } from './reducer';

interface SessionGroupMutationSnapshot {
  account: AccountMutationSnapshot;
  scopeGeneration: number;
}

const captureSessionGroupMutationSnapshot = (
  state: SessionStore,
): SessionGroupMutationSnapshot | undefined => {
  const account = captureAccountMutationSnapshot(useUserStore.getState());
  if (!account) return undefined;

  return {
    account,
    scopeGeneration: state.scopeGeneration,
  };
};

const isSessionGroupMutationCurrent = (
  state: SessionStore,
  snapshot: SessionGroupMutationSnapshot,
): boolean =>
  isAccountMutationCurrent(useUserStore.getState(), snapshot.account) &&
  state.scopeGeneration === snapshot.scopeGeneration;

/* eslint-disable typescript-sort-keys/interface */
export interface SessionGroupAction {
  addSessionGroup: (name: string) => Promise<string>;
  clearSessionGroups: () => Promise<void>;
  removeSessionGroup: (id: string) => Promise<void>;
  updateSessionGroupName: (id: string, name: string) => Promise<void>;
  updateSessionGroupSort: (items: SessionGroupItem[]) => Promise<void>;
  internal_dispatchSessionGroups: (payload: SessionGroupsDispatch) => void;
}
/* eslint-enable */

export const createSessionGroupSlice: StateCreator<
  SessionStore,
  [['zustand/devtools', never]],
  [],
  SessionGroupAction
> = (set, get) => ({
  addSessionGroup: async (name) => {
    const mutationSnapshot = captureSessionGroupMutationSnapshot(get());
    if (!mutationSnapshot) return '';

    const id = await sessionService.createSessionGroup(name);
    if (!isSessionGroupMutationCurrent(get(), mutationSnapshot)) return '';

    await get().refreshSessions();
    if (!isSessionGroupMutationCurrent(get(), mutationSnapshot)) return '';

    return id;
  },

  clearSessionGroups: async () => {
    const mutationSnapshot = captureSessionGroupMutationSnapshot(get());
    if (!mutationSnapshot) return;

    await sessionService.removeSessionGroups();
    if (!isSessionGroupMutationCurrent(get(), mutationSnapshot)) return;

    await get().refreshSessions();
  },

  removeSessionGroup: async (id) => {
    const mutationSnapshot = captureSessionGroupMutationSnapshot(get());
    if (!mutationSnapshot) return;

    await sessionService.removeSessionGroup(id);
    if (!isSessionGroupMutationCurrent(get(), mutationSnapshot)) return;

    await get().refreshSessions();
  },

  updateSessionGroupName: async (id, name) => {
    const mutationSnapshot = captureSessionGroupMutationSnapshot(get());
    if (!mutationSnapshot) return;

    await sessionService.updateSessionGroup(id, { name });
    if (!isSessionGroupMutationCurrent(get(), mutationSnapshot)) return;

    await get().refreshSessions();
  },
  updateSessionGroupSort: async (items) => {
    const mutationSnapshot = captureSessionGroupMutationSnapshot(get());
    if (!mutationSnapshot) return;

    const sortMap = items.map((item, index) => ({ id: item.id, sort: index }));

    get().internal_dispatchSessionGroups({ sortMap, type: 'updateSessionGroupOrder' });

    message.loading({
      content: t('sessionGroup.sorting', { ns: 'chat' }),
      duration: 0,
      key: 'updateSessionGroupSort',
    });

    await sessionService.updateSessionGroupOrder(sortMap);
    if (!isSessionGroupMutationCurrent(get(), mutationSnapshot)) return;

    message.destroy('updateSessionGroupSort');
    message.success(t('sessionGroup.sortSuccess', { ns: 'chat' }));

    await get().refreshSessions();
  },

  /* eslint-disable sort-keys-fix/sort-keys-fix */
  internal_dispatchSessionGroups: (payload) => {
    const nextSessionGroups = sessionGroupsReducer(get().sessionGroups, payload);
    get().internal_processSessions(get().sessions, nextSessionGroups, 'updateSessionGroups');
  },
});
