import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CHATHUB_ACCOUNT_SCOPE_HEADER } from '@/const/auth';

import { createLambdaContext } from './context';

describe('createLambdaContext account scope', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('copies the asserted account scope into the request context', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ENABLE_MOCK_DEV_USER', '1');
    vi.stubEnv('MOCK_DEV_USER_ID', 'account-a');
    const request = new NextRequest('https://chathub.example/trpc/lambda/apiKey.getApiKeys', {
      headers: {
        [CHATHUB_ACCOUNT_SCOPE_HEADER]: 'user:account-a',
      },
    });

    await expect(createLambdaContext(request)).resolves.toMatchObject({
      accountScope: 'user:account-a',
      userId: 'account-a',
    });
  });
});
