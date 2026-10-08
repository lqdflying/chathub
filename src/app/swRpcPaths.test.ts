import { describe, expect, it } from 'vitest';

import { isRpcNetworkOnlyPath } from './swRpcPaths';

describe('isRpcNetworkOnlyPath', () => {
  it.each(['/trpc/lambda', '/trpc/tools/mcp.callTool', '/webapi/chat/openai'])(
    'keeps %s off the runtime cache',
    (pathname) => {
      expect(isRpcNetworkOnlyPath(pathname)).toBe(true);
    },
  );

  it.each(['/api/auth/session', '/api/trpc', '/chat', '/trpc', '/webapi'])(
    'leaves %s to the default cache',
    (pathname) => {
      expect(isRpcNetworkOnlyPath(pathname)).toBe(false);
    },
  );
});
