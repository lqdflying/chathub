import {
  AccountMutationSnapshot,
  captureAccountMutationSnapshot,
  isAccountMutationCurrent,
} from '@/store/accountMutation';
import { useUserStore } from '@/store/user';

export interface ToolMutationCheckpoint {
  accountMutationSnapshot: AccountMutationSnapshot;
  scopeGeneration: number;
}

export interface PluginInstallLoadingOperation {
  checkpoint: ToolMutationCheckpoint;
  identifier: string;
  operationKey: string;
  token: symbol;
}

type UpdateInstallLoadingState = (
  identifier: string,
  loading: boolean | undefined,
) => void;

const pluginInstallLoadingOwners = new Map<string, Set<symbol>>();

export const captureToolMutationCheckpoint = (
  scopeGeneration: number,
): ToolMutationCheckpoint | undefined => {
  const accountMutationSnapshot = captureAccountMutationSnapshot(useUserStore.getState());
  if (!accountMutationSnapshot) return;

  return { accountMutationSnapshot, scopeGeneration };
};

export const isToolMutationCurrent = (
  checkpoint: ToolMutationCheckpoint,
  scopeGeneration: number,
): boolean =>
  isAccountMutationCurrent(useUserStore.getState(), checkpoint.accountMutationSnapshot) &&
  checkpoint.scopeGeneration === scopeGeneration;

const getPluginInstallLoadingOperationKey = (
  checkpoint: ToolMutationCheckpoint,
  identifier: string,
): string =>
  JSON.stringify([
    checkpoint.accountMutationSnapshot.scope,
    checkpoint.accountMutationSnapshot.ownershipInvalidationGeneration,
    checkpoint.scopeGeneration,
    identifier,
  ]);

export const acquirePluginInstallLoading = (
  checkpoint: ToolMutationCheckpoint,
  identifier: string,
  updateInstallLoadingState: UpdateInstallLoadingState,
): PluginInstallLoadingOperation => {
  const operationKey = getPluginInstallLoadingOperationKey(checkpoint, identifier);
  const token = Symbol(identifier);
  const currentOwners = pluginInstallLoadingOwners.get(operationKey);

  if (currentOwners) {
    currentOwners.add(token);
  } else {
    pluginInstallLoadingOwners.set(operationKey, new Set([token]));
  }

  updateInstallLoadingState(identifier, true);

  return { checkpoint, identifier, operationKey, token };
};

export const releasePluginInstallLoading = (
  operation: PluginInstallLoadingOperation,
  scopeGeneration: number,
  updateInstallLoadingState: UpdateInstallLoadingState,
): void => {
  const currentOwners = pluginInstallLoadingOwners.get(operation.operationKey);
  if (!currentOwners?.delete(operation.token)) return;

  if (currentOwners.size > 0) return;

  pluginInstallLoadingOwners.delete(operation.operationKey);

  if (!isToolMutationCurrent(operation.checkpoint, scopeGeneration)) return;

  updateInstallLoadingState(operation.identifier, undefined);
};
