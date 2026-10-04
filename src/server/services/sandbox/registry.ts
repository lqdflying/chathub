import { OpenSandboxProvider } from './providers/opensandbox/provider';
import type { SandboxProvider } from './types';

/** OpenSandbox is the only backend; the DifySandbox provider was removed. */
export const getSandboxProvider = (): SandboxProvider => new OpenSandboxProvider();

export const isSandboxConfigured = () => getSandboxProvider().isConfigured();
