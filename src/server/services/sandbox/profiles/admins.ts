import type { LobeChatDatabase } from '@lobechat/database';

import { UserModel } from '@/database/models/user';
import { sandboxEnv } from '@/envs/sandbox';

export interface SandboxHubAdmins {
  emails: Set<string>;
  ids: Set<string>;
}

/** `SANDBOX_HUB_ADMINS`: entries with `@` are emails (case-insensitive), the rest user ids. */
export const parseSandboxHubAdmins = (value?: string): SandboxHubAdmins => {
  const admins: SandboxHubAdmins = { emails: new Set(), ids: new Set() };
  for (const raw of (value ?? '').split(',')) {
    const entry = raw.trim();
    if (!entry) continue;
    if (entry.includes('@')) admins.emails.add(entry.toLowerCase());
    else admins.ids.add(entry);
  }
  return admins;
};

const configuredAdmins = () => parseSandboxHubAdmins(sandboxEnv.SANDBOX_HUB_ADMINS);

/** Whether anyone can edit instructions on this server. */
export const hasSandboxHubAdmins = (admins: SandboxHubAdmins = configuredAdmins()) =>
  admins.ids.size > 0 || admins.emails.size > 0;

/**
 * Sandbox Hub admins edit profile instructions for every user. Nobody is an
 * admin while the list is empty.
 */
export const isSandboxHubAdmin = async (
  db: LobeChatDatabase,
  userId: string,
  admins: SandboxHubAdmins = configuredAdmins(),
): Promise<boolean> => {
  if (admins.ids.has(userId)) return true;
  if (admins.emails.size === 0) return false;
  const user = await UserModel.findById(db, userId);
  const email = user?.email?.trim().toLowerCase();
  return !!email && admins.emails.has(email);
};
