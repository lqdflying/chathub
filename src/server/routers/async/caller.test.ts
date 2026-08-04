// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CHATHUB_KNOWLEDGE_DIAGNOSTIC_HEADER } from '@/const/tools';
import { runWithKnowledgeDebugContext } from '@/libs/logger/knowledgeDebug';

import { createAsyncServerClient } from './caller';

const mocks = vi.hoisted(() => ({
  createTRPCClient: vi.fn(() => ({})),
  httpLink: vi.fn((options) => options),
}));

vi.mock('@trpc/client', () => ({
  createTRPCClient: mocks.createTRPCClient,
  httpLink: mocks.httpLink,
}));
vi.mock('@/config/db', () => ({
  serverDBEnv: { KEY_VAULTS_SECRET: 'test-internal-secret' },
}));
vi.mock('@/envs/app', () => ({
  appEnv: {
    APP_URL: 'https://chathub.example.com',
    INTERNAL_APP_URL: undefined,
    MIDDLEWARE_REWRITE_THROUGH_LOCAL: false,
  },
}));
vi.mock('@/libs/trpc/async/imageDiagnosticFetch', () => ({
  createImageDiagnosticFetch: (fetchFunction: typeof fetch) => fetchFunction,
}));
vi.mock('@/libs/trpc/async', () => ({
  createAsyncCallerFactory: vi.fn(),
}));
vi.mock('@/server/modules/KeyVaultsEncrypt', () => ({
  KeyVaultsGateKeeper: {
    initWithEnvKey: vi.fn(async () => ({
      encrypt: vi.fn(async () => 'encrypted-payload'),
    })),
  },
}));
vi.mock('./index', () => ({ asyncRouter: {} }));

afterEach(() => {
  vi.clearAllMocks();
});

describe('createAsyncServerClient Knowledge Base diagnostics', () => {
  it('propagates the current diagnostic id in the internal-only header', async () => {
    const diagnosticId = 'kb_1234567890abcdef';

    await runWithKnowledgeDebugContext({ diagnosticId }, () =>
      createAsyncServerClient('user-1', {}),
    );

    const linkOptions = mocks.httpLink.mock.calls[0][0];
    expect(linkOptions.headers()).toMatchObject({
      Authorization: 'Bearer test-internal-secret',
      [CHATHUB_KNOWLEDGE_DIAGNOSTIC_HEADER]: diagnosticId,
    });
  });
});
