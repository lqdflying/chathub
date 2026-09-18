import type { LobeChatDatabase } from '@lobechat/database';

import { DEFAULT_SYSTEM_AGENT_CONFIG } from '@/const/settings';
import { UserModel } from '@/database/models/user';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

/**
 * Resolve the user's History Compress (summarizer) model selection server-side.
 * Shared by the dream job and the chat overflow-recovery compaction so both
 * summarize with the configured model instead of the chat model (F6).
 * Falls back to the default system-agent config when unset or unreadable.
 */
export const loadHistoryCompressModel = async (
  db: LobeChatDatabase,
  userId: string,
): Promise<{ model: string; provider: string }> => {
  try {
    const state = await new UserModel(db, userId).getUserState(
      KeyVaultsGateKeeper.getUserKeyVaults,
    );
    const configured = (
      state.settings?.systemAgent as { historyCompress?: { model: string; provider: string } }
    )?.historyCompress;
    if (configured?.model && configured.provider) return configured;
  } catch {
    /* fall through to defaults */
  }
  return DEFAULT_SYSTEM_AGENT_CONFIG.historyCompress;
};
