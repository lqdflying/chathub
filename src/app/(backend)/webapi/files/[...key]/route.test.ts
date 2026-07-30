import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

const { mockCreateLambdaContext, mockGetServerDB, mockIsKeyOwnedByUser, mockGetFileByteArray } =
  vi.hoisted(() => ({
    mockCreateLambdaContext: vi.fn(),
    mockGetServerDB: vi.fn(),
    mockIsKeyOwnedByUser: vi.fn(),
    mockGetFileByteArray: vi.fn(),
  }));

vi.mock('@/libs/trpc/lambda/context', () => ({
  createLambdaContext: (...args: unknown[]) => mockCreateLambdaContext(...args),
}));
vi.mock('@/database/server', () => ({
  getServerDB: (...args: unknown[]) => mockGetServerDB(...args),
}));
vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({ isKeyOwnedByUser: mockIsKeyOwnedByUser })),
}));
vi.mock('@/server/modules/S3', () => ({
  S3: vi.fn().mockImplementation(() => ({ getFileByteArray: mockGetFileByteArray })),
}));

const makeRequest = (key = 'files/466737/abc.png') =>
  new NextRequest(`http://localhost/webapi/files/${key}`);
const makeParams = (key: string[]) => ({ params: Promise.resolve({ key }) });

describe('GET /webapi/files/[...key]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateLambdaContext.mockResolvedValue({ userId: 'user-1' });
    mockGetServerDB.mockResolvedValue({ database: true });
    mockIsKeyOwnedByUser.mockResolvedValue(true);
    mockGetFileByteArray.mockResolvedValue(new Uint8Array([1, 2, 3]));
  });

  it('requires authentication', async () => {
    mockCreateLambdaContext.mockResolvedValue({});

    const response = await GET(makeRequest(), makeParams(['files', 'a.png']));

    expect(response.status).toBe(401);
    expect(mockGetServerDB).not.toHaveBeenCalled();
  });

  it('returns 404 without touching storage when the key is not owned by the user', async () => {
    mockIsKeyOwnedByUser.mockResolvedValue(false);

    const response = await GET(makeRequest(), makeParams(['files', '466737', 'abc.png']));

    expect(response.status).toBe(404);
    expect(mockGetFileByteArray).not.toHaveBeenCalled();
  });

  it('serves an owned object with a private cache header', async () => {
    const response = await GET(makeRequest(), makeParams(['files', '466737', 'abc.png']));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Cache-Control')).toContain('private');
    expect(mockIsKeyOwnedByUser).toHaveBeenCalledWith('files/466737/abc.png');
    expect(mockGetFileByteArray).toHaveBeenCalledWith('files/466737/abc.png');
  });

  it('joins multi-segment keys before the ownership check', async () => {
    await GET(makeRequest(), makeParams(['references', 'nested', 'image.png']));

    expect(mockIsKeyOwnedByUser).toHaveBeenCalledWith('references/nested/image.png');
  });
});
