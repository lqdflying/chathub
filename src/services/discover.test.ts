import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lambdaClient } from '@/libs/trpc/client';
import { preferenceSelectors } from '@/store/user/selectors';

import { discoverService } from './discover';

vi.mock('@/libs/trpc/client', () => ({
  lambdaClient: {
    market: {
      reportMcpInstallResult: {
        mutate: vi.fn(),
      },
    },
  },
}));

describe('DiscoverService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(lambdaClient.market.reportMcpInstallResult.mutate).mockReset();
    vi.spyOn(preferenceSelectors, 'userAllowTrace').mockReturnValue(true);
  });

  it('does not report MCP installation after invalidation during token setup', async () => {
    let resolveTokenSetup!: () => void;
    const tokenSetupPromise = new Promise<void>((resolve) => {
      resolveTokenSetup = resolve;
    });
    const injectTokenSpy = vi
      .spyOn(discoverService as any, 'injectMPToken')
      .mockReturnValue(tokenSetupPromise);
    let isCurrent = true;

    const reportPromise = discoverService.reportMcpInstallResult(
      {
        identifier: 'test-plugin',
        platform: 'linux',
        success: true,
        userAgent: 'ChatHub Test',
        version: '1.0.0',
      },
      { isCurrent: () => isCurrent },
    );

    expect(injectTokenSpy).toHaveBeenCalledOnce();

    isCurrent = false;
    resolveTokenSetup();
    await reportPromise;

    expect(lambdaClient.market.reportMcpInstallResult.mutate).not.toHaveBeenCalled();
  });
});
