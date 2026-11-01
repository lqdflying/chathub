import type { LobeBuiltinTool, SandboxProfileItem } from '@lobechat/types';
import { useEffect } from 'react';
import { StateCreator } from 'zustand/vanilla';

import { sandboxHubService } from '@/services/sandboxHub';
import { useUserStore } from '@/store/user';
import { builtinTools as staticBuiltinTools } from '@/tools';
import { createSandboxProfileManifest } from '@/tools/sandbox';
import { setNamespace } from '@/utils/storeDebug';

import type { ToolStore } from '../../store';

const n = setNamespace('sandboxHub');

/**
 * Static builtins plus one Sandbox tool per profile the user turned on. The
 * Sandbox tools go last, where the single static Sandbox manifest used to be,
 * so an existing lobe-sandbox agent keeps the same tool order and prompt.
 */
export const composeBuiltinTools = (profiles: SandboxProfileItem[]): LobeBuiltinTool[] => [
  ...staticBuiltinTools,
  ...profiles
    .filter((profile) => profile.enabled && profile.available)
    .map((profile) => ({
      identifier: profile.identifier,
      manifest: createSandboxProfileManifest(profile),
      type: 'builtin' as const,
    })),
];

const currentScope = () => useUserStore.getState().userStateScope ?? undefined;

export interface SandboxHubAction {
  /** Applies a profile list for `scope` unless the account changed meanwhile. */
  applySandboxProfiles: (scope: string, profiles: SandboxProfileItem[]) => void;
  /** Loads the profiles once per account before a browser-path send that lists a Sandbox tool. */
  ensureSandboxProfiles: () => Promise<void>;
  loadSandboxProfiles: (scope: string) => Promise<void>;
  setSandboxProfileEnabled: (profileId: string, enabled: boolean) => Promise<void>;
  /** Loads the Hub profiles for the signed-in account once its user state is ready. */
  useFetchSandboxProfiles: (enabled: boolean) => void;
}

const inflight = new Map<string, Promise<void>>();
/** Bumped when a toggle starts, so an older profile list cannot overwrite it. */
let sandboxProfilesRevision = 0;

export const createSandboxHubSlice: StateCreator<
  ToolStore,
  [['zustand/devtools', never]],
  [],
  SandboxHubAction
> = (set, get) => ({
  applySandboxProfiles: (scope, profiles) => {
    if (currentScope() !== scope) return;
    set(
      {
        builtinTools: composeBuiltinTools(profiles),
        sandboxProfiles: profiles,
        sandboxProfilesScope: scope,
      },
      false,
      n('applySandboxProfiles'),
    );
  },

  ensureSandboxProfiles: async () => {
    const scope = currentScope();
    if (!scope || get().sandboxProfilesScope === scope) return;
    try {
      await get().loadSandboxProfiles(scope);
    } catch {
      // Without the catalog the send simply offers no Sandbox tool.
    }
  },

  loadSandboxProfiles: (scope) => {
    const running = inflight.get(scope);
    if (running) return running;
    const revision = sandboxProfilesRevision;
    const task = sandboxHubService
      .listProfiles(scope)
      .then((profiles) => {
        if (revision !== sandboxProfilesRevision) return;
        get().applySandboxProfiles(scope, profiles);
      })
      .finally(() => inflight.delete(scope));
    inflight.set(scope, task);
    return task;
  },

  setSandboxProfileEnabled: async (profileId, enabled) => {
    const scope = currentScope();
    if (!scope) return;
    const revision = ++sandboxProfilesRevision;
    const profiles = await sandboxHubService.setProfileEnabled(scope, profileId, enabled);
    if (revision !== sandboxProfilesRevision) return;
    get().applySandboxProfiles(scope, profiles);
  },

  useFetchSandboxProfiles: (enabled) => {
    const scope = useUserStore((s) => (s.isUserStateInit ? s.userStateScope : undefined));
    useEffect(() => {
      if (!enabled || !scope || get().sandboxProfilesScope === scope) return;
      get()
        .loadSandboxProfiles(scope)
        .catch(() => undefined);
    }, [enabled, scope]);
  },
});
