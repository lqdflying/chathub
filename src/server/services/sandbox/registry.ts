import { codeInterpreterEnv } from '@/envs/codeInterpreter';

import { DifySandboxProvider } from './providers/dify/provider';
import {
  SandboxError,
  type SandboxProvider,
  type SandboxRunResult,
} from './types';

class UnconfiguredSandboxProvider implements SandboxProvider {
  readonly id: string;

  constructor(id: string) {
    this.id = id;
  }

  isConfigured() {
    return false;
  }

  async run(): Promise<SandboxRunResult> {
    throw new SandboxError(
      'NotConfigured',
      `Unknown SANDBOX_PROVIDER "${this.id}". Supported: dify.`,
    );
  }
}

export const resolveSandboxProviderId = () => {
  const raw = codeInterpreterEnv.SANDBOX_PROVIDER?.trim().toLowerCase();
  return raw || 'dify';
};

export const getSandboxProvider = (): SandboxProvider => {
  const id = resolveSandboxProviderId();
  switch (id) {
    case 'dify': {
      return new DifySandboxProvider();
    }
    default: {
      return new UnconfiguredSandboxProvider(id);
    }
  }
};

export const isSandboxConfigured = () => getSandboxProvider().isConfigured();
