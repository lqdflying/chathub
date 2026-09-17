import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

import { sanitizeToolDebugPayload } from '@/libs/logger/toolsDebug';

import { MCPClient } from './client';

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn(),
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi.fn(),
}));

const MockSDKClient = vi.mocked(
  (await import('@modelcontextprotocol/sdk/client/index.js')).Client,
);
const MockStreamableTransport = vi.mocked(
  (await import('@modelcontextprotocol/sdk/client/streamableHttp.js'))
    .StreamableHTTPClientTransport,
);

const getProperty = (value: any, key: string) =>
  value.entries.find(
    (entry: any) =>
      entry.key.hash === createHash('sha256').update(key).digest('hex').slice(0, 16),
  );

describe('sanitizeToolDebugPayload', () => {
  it('passes through null, undefined, and primitives', () => {
    expect(sanitizeToolDebugPayload(null)).toBeNull();
    expect(sanitizeToolDebugPayload(undefined)).toBeUndefined();
    expect(sanitizeToolDebugPayload(42)).toBe(42);
    expect(sanitizeToolDebugPayload(true)).toBe(true);
  });

  it('normalizes JSON-unsafe primitives without exposing their values', () => {
    expect(sanitizeToolDebugPayload(42n)).toEqual({ type: 'bigint' });
    expect(sanitizeToolDebugPayload(Symbol('private-symbol'))).toEqual({ type: 'symbol' });
    expect(sanitizeToolDebugPayload(() => 'private-result')).toEqual({ type: 'function' });
  });

  it('omits secret-keyed fields, case-insensitively', () => {
    const input = {
      ACCESS_TOKEN: 'abc',
      ApiKey: 'ghi',
      Authorization: 'Bearer xyz',
      COOKIE: 'session',
      accessToken: 'secret-token',
      api_key: 'jkl',
      authorizationHeader: 'Bearer y',
      name: 'public',
      nested: { refreshToken: 'mno', value: 1 },
      password: 'def',
      userId: 123_456_789,
    };

    const out = sanitizeToolDebugPayload(input) as any;

    for (const key of [
      'accessToken',
      'ACCESS_TOKEN',
      'api_key',
      'ApiKey',
      'password',
      'Authorization',
      'authorizationHeader',
      'COOKIE',
    ]) {
      expect(getProperty(out, key)).toBeUndefined();
    }
    const nested = getProperty(out, 'nested').value;
    expect(getProperty(nested, 'refreshToken')).toBeUndefined();
    expect(getProperty(nested, 'value').value).toBe(1);
    expect(getProperty(out, 'name').value).toMatchObject({ length: 6, type: 'string' });
    expect(getProperty(out, 'userId').value).toMatchObject({ type: 'identifier' });
    expect(JSON.stringify(out)).not.toMatch(/abc|def|ghi|jkl|mno|session|secret-token|Bearer/);
    expect(JSON.stringify(out)).not.toContain('123456789');
  });

  it('fingerprints long strings without retaining any raw prefix', () => {
    const long = 'a'.repeat(600);
    const out = sanitizeToolDebugPayload({ text: long }) as any;

    const text = getProperty(out, 'text').value;
    expect(text).toMatchObject({ length: 600, type: 'string' });
    expect(text.hash).toMatch(/^[a-f0-9]{16}$/);
    expect(JSON.stringify(out)).not.toContain('a'.repeat(20));
  });

  it('fingerprints short strings too', () => {
    const out = sanitizeToolDebugPayload({ text: 'short' }) as any;
    expect(getProperty(out, 'text').value).toMatchObject({ length: 5, type: 'string' });
    expect(JSON.stringify(out)).not.toContain('short');
  });

  it('caps arrays and reports the remainder', () => {
    const out = sanitizeToolDebugPayload({ list: Array.from({ length: 12 }, (_, index) => index) }) as any;
    expect(getProperty(out, 'list').value).toEqual({
      itemCount: 12,
      items: Array.from({ length: 10 }, (_, index) => index),
      omittedItems: 2,
      type: 'array',
    });
  });

  it('describes short arrays without dropping items', () => {
    const out = sanitizeToolDebugPayload({ list: [1, 2] }) as any;
    expect(getProperty(out, 'list').value).toEqual({
      itemCount: 2,
      items: [1, 2],
      omittedItems: 0,
      type: 'array',
    });
  });

  it('bounds recursion depth', () => {
    const deep: any = { a: { b: { c: { d: { e: { f: { g: 'too deep' } } } } } } };
    const out = sanitizeToolDebugPayload(deep) as any;
    // depth 0→5 allowed; beyond that is replaced with the marker.
    const a = getProperty(out, 'a').value;
    const b = getProperty(a, 'b').value;
    const c = getProperty(b, 'c').value;
    const d = getProperty(c, 'd').value;
    const e = getProperty(d, 'e').value;
    expect(getProperty(e, 'f').value).toBe('[truncated:max-depth]');
  });

  it('does not mutate the input object', () => {
    const input = { accessToken: 'secret', list: [1, 2, 3, 4], text: 'x'.repeat(600) };
    const snapshot = JSON.parse(JSON.stringify(input));

    sanitizeToolDebugPayload(input);

    expect(input).toEqual(snapshot);
  });

  it('replaces property values that cannot be read', () => {
    const input = {};
    Object.defineProperty(input, 'danger', {
      enumerable: true,
      get: () => {
        throw new Error('private getter failure');
      },
    });

    const out = sanitizeToolDebugPayload(input) as any;

    expect(getProperty(out, 'danger').value).toEqual({ type: 'unavailable' });
    expect(JSON.stringify(out)).not.toContain('private getter failure');
  });

  it('sanitizes a realistic MCP tool result shape', () => {
    const result = {
      content: [
        { text: 'hello', type: 'text' },
        { text: 'world', type: 'text' },
        { text: 'extra1', type: 'text' },
        { text: 'extra2', type: 'text' },
      ],
      isError: false,
      token: 'should-hide',
    };

    const out = sanitizeToolDebugPayload(result) as any;

    expect(getProperty(out, 'isError').value).toBe(false);
    expect(getProperty(out, 'token')).toBeUndefined();
    const content = getProperty(out, 'content').value;
    expect(content).toMatchObject({ itemCount: 4, omittedItems: 0, type: 'array' });
    expect(content.items).toHaveLength(4);
    expect(getProperty(content.items[0], 'text').value).toMatchObject({ length: 5, type: 'string' });
    expect(getProperty(content.items[0], 'type').value).toMatchObject({ length: 4, type: 'string' });
    expect(JSON.stringify(out)).not.toMatch(/hello|world|extra/);
  });

  it('fingerprints user-controlled property names and bounds object width', () => {
    const input = Object.fromEntries(
      Array.from({ length: 55 }, (_, index) => [`person-${index}@example.com`, index]),
    );
    const out = sanitizeToolDebugPayload(input) as any;

    expect(out).toMatchObject({ omittedProperties: 5, propertyCount: 55, type: 'object' });
    expect(out.entries).toHaveLength(50);
    expect(JSON.stringify(out)).not.toContain('person-');
  });
});

describe('MCPClient', () => {
  const params = {
    name: 'test-mcp',
    type: 'http' as const,
    url: 'https://mcp.example.com/mcp',
  };

  let sdkClient: any;
  let transport: any;

  beforeEach(() => {
    vi.clearAllMocks();
    sdkClient = {
      callTool: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
      connect: vi.fn().mockResolvedValue(undefined),
      getServerCapabilities: vi.fn().mockReturnValue({ tools: {} }),
      getServerVersion: vi.fn().mockReturnValue({ name: 'test-server', version: '1.0.0' }),
    };
    transport = { close: vi.fn().mockResolvedValue(undefined) };
    MockSDKClient.mockImplementation(() => sdkClient);
    MockStreamableTransport.mockImplementation(() => transport);
  });

  describe('disconnect', () => {
    it('closes the SDK client (which also closes the transport)', async () => {
      const client = new MCPClient(params);

      await client.disconnect();

      expect(sdkClient.close).toHaveBeenCalledTimes(1);
      expect(transport.close).not.toHaveBeenCalled();
    });

    it('falls back to closing the transport when SDK close fails', async () => {
      sdkClient.close.mockRejectedValueOnce(new Error('close failed'));
      const client = new MCPClient(params);

      await client.disconnect();

      expect(sdkClient.close).toHaveBeenCalledTimes(1);
      expect(transport.close).toHaveBeenCalledTimes(1);
    });
  });

  describe('initialize', () => {
    it('connects to the server', async () => {
      const client = new MCPClient(params);

      await client.initialize();

      expect(sdkClient.connect).toHaveBeenCalledTimes(1);
      expect(sdkClient.connect.mock.calls[0][0]).toBe(transport);
    });

    it('rejects with INITIALIZATION_TIMEOUT and closes the half-open transport', async () => {
      process.env.MCP_INITIALIZATION_TIMEOUT = '50';
      sdkClient.connect.mockReturnValue(new Promise(() => {}));
      const client = new MCPClient(params);

      try {
        await expect(client.initialize()).rejects.toMatchObject({
          data: { type: 'INITIALIZATION_TIMEOUT' },
        });
        expect(transport.close).toHaveBeenCalledTimes(1);
      } finally {
        delete process.env.MCP_INITIALIZATION_TIMEOUT;
      }
    });

    it('still wraps unknown connect failures as UNKNOWN_ERROR', async () => {
      sdkClient.connect.mockRejectedValue(new Error('socket hangup'));
      const client = new MCPClient(params);

      await expect(client.initialize()).rejects.toMatchObject({
        data: { type: 'UNKNOWN_ERROR' },
      });
    });
  });

  describe('callTool', () => {
    it('passes the configured timeout to the SDK', async () => {
      sdkClient.callTool.mockResolvedValue({ content: [], isError: false });
      const client = new MCPClient(params);

      await client.callTool('testTool', { a: 1 });

      expect(sdkClient.callTool).toHaveBeenCalledWith(
        { arguments: { a: 1 }, name: 'testTool' },
        undefined,
        { timeout: 60_000 },
      );
    });

    it('forwards an abort signal to the SDK request options', async () => {
      sdkClient.callTool.mockResolvedValue({ content: [], isError: false });
      const client = new MCPClient(params);
      const controller = new AbortController();

      await client.callTool('testTool', {}, { signal: controller.signal });

      expect(sdkClient.callTool).toHaveBeenCalledWith(
        { arguments: {}, name: 'testTool' },
        undefined,
        { signal: controller.signal, timeout: 60_000 },
      );
    });

    it('maps streamable-HTTP session expiry to NoValidSessionId', async () => {
      sdkClient.callTool.mockRejectedValue(
        new Error('Error POSTing to endpoint: No valid session ID provided'),
      );
      const client = new MCPClient(params);

      await expect(client.callTool('testTool', {})).rejects.toThrow('NoValidSessionId');
    });

    it('rethrows other errors unchanged', async () => {
      const boom = new Error('upstream boom');
      sdkClient.callTool.mockRejectedValue(boom);
      const client = new MCPClient(params);

      await expect(client.callTool('testTool', {})).rejects.toBe(boom);
    });
  });
});
