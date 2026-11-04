import type { LobeBuiltinTool, SandboxProfileItem } from '@lobechat/types';
import { useEffect } from 'react';
import { StateCreator } from 'zustand/vanilla';

import { sandboxHubService } from '@/services/sandboxHub';
import { useUserStore } from '@/store/user';
import { builtinTools as staticBuiltinTools } from '@/tools';
import { createSandboxProfileManifest } from '@/tools/sandbox';
import { SANDBOX_SHARED_INSTRUCTION_ID } from '@/tools/sandbox/const';
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

/**
 * Admins edit instructions for every user, so an open tab reloads the list
 * before a browser-path send once it is this old. Durable sends read the
 * database on every run.
 */
export const SANDBOX_PROFILES_MAX_AGE_MS = 5 * 60 * 1000;

export interface SandboxHubAction {
  /** Applies a profile list for `scope` unless the account changed meanwhile. */
  applySandboxProfiles: (scope: string, profiles: SandboxProfileItem[]) => void;
  /**
   * Loads the profiles before a browser-path send that lists a Sandbox tool:
   * once per account, and again when the list is older than 5 minutes.
   */
  ensureSandboxProfiles: () => Promise<void>;
  loadSandboxProfiles: (scope: string) => Promise<void>;
  /** Admin only: restores the General instruction for every user. */
  resetSandboxProfileInstruction: (
    profileId: typeof SANDBOX_SHARED_INSTRUCTION_ID,
  ) => Promise<void>;
  setSandboxProfileEnabled: (profileId: string, enabled: boolean) => Promise<void>;
  /** Admin only: replaces the General instruction for every user. */
  setSandboxProfileInstruction: (
    profileId: typeof SANDBOX_SHARED_INSTRUCTION_ID,
    instruction: string,
  ) => Promise<void>;
  /** Loads the Hub profiles for the signed-in account once its user state is ready. */
  useFetchSandboxProfiles: (enabled: boolean) => void;
}

const inflight = new Map<string, Promise<void>>();
/** Bumped when a change starts, so an older profile list cannot overwrite it. */
let sandboxProfilesRevision = 0;

/** Runs a Hub change and applies the list it returns, unless a newer change started. */
const applyChange = async (
  get: () => ToolStore,
  change: (scope: string) => Promise<SandboxProfileItem[]>,
) => {
  const scope = currentScope();
  if (!scope) return;
  const revision = ++sandboxProfilesRevision;
  const profiles = await change(scope);
  if (revision !== sandboxProfilesRevision) return;
  get().applySandboxProfiles(scope, profiles);
};

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
        sandboxProfilesLoadedAt: Date.now(),
        sandboxProfilesScope: scope,
      },
      false,
      n('applySandboxProfiles'),
    );
  },

  ensureSandboxProfiles: async () => {
    const scope = currentScope();
    if (!scope) return;
    const { sandboxProfilesLoadedAt, sandboxProfilesScope } = get();
    const fresh =
      sandboxProfilesScope === scope &&
      sandboxProfilesLoadedAt !== undefined &&
      Date.now() - sandboxProfilesLoadedAt < SANDBOX_PROFILES_MAX_AGE_MS;
    if (fresh) return;
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

  resetSandboxProfileInstruction: (profileId) =>
    applyChange(get, (scope) => sandboxHubService.resetInstruction(scope, profileId)),

  setSandboxProfileEnabled: (profileId, enabled) =>
    applyChange(get, (scope) => sandboxHubService.setProfileEnabled(scope, profileId, enabled)),

  setSandboxProfileInstruction: (profileId, instruction) =>
    applyChange(get, (scope) => sandboxHubService.setInstruction(scope, profileId, instruction)),

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
