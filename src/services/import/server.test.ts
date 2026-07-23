import { beforeEach, describe, expect, it, vi } from 'vitest';

import { messageService } from '@/services/message';
import { ImportStage } from '@/types/importer';

import { ServerService } from './server';

const mockCreateHeaderWithAuth = vi.fn();

vi.mock('@/services/_auth', () => ({
  createHeaderWithAuth: (...args: unknown[]) => mockCreateHeaderWithAuth(...args),
}));
vi.mock('@/services/message', () => ({
  messageService: {
    getConversationVersion: vi.fn(),
  },
}));
vi.mock('@/store/user', () => ({
  useUserStore: {
    getState: () => ({ importAppSettings: vi.fn() }),
  },
}));

let nextResponse = {
  body: JSON.stringify({ results: { messages: { added: 1 } }, success: true }),
  status: 200,
};

class MockXMLHttpRequest {
  static instances: MockXMLHttpRequest[] = [];

  body?: string;
  headers: Record<string, string> = {};
  method?: string;
  responseText = '';
  status = 0;
  upload: {
    addEventListener: (type: string, listener: (event: ProgressEvent) => void) => void;
    listeners: Record<string, (event: ProgressEvent) => void>;
  } = {
    addEventListener: (type, listener) => {
      this.upload.listeners[type] = listener;
    },
    listeners: {},
  };
  url?: string;
  private listeners: Record<string, () => void> = {};

  constructor() {
    MockXMLHttpRequest.instances.push(this);
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(key: string, value: string) {
    this.headers[key] = value;
  }

  addEventListener(type: string, listener: () => void) {
    this.listeners[type] = listener;
  }

  send(body: string) {
    this.body = body;
    this.status = nextResponse.status;
    this.responseText = nextResponse.body;
    this.upload.listeners.progress?.({
      lengthComputable: true,
      loaded: body.length,
      total: body.length,
    } as ProgressEvent);
    this.upload.listeners.load?.({} as ProgressEvent);
    this.listeners.load?.();
  }
}

describe('server data import transport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockXMLHttpRequest.instances = [];
    nextResponse = {
      body: JSON.stringify({ results: { messages: { added: 1 } }, success: true }),
      status: 200,
    };
    vi.stubGlobal('XMLHttpRequest', MockXMLHttpRequest);
    vi.mocked(messageService.getConversationVersion).mockResolvedValue(7);
    mockCreateHeaderWithAuth.mockResolvedValue({
      'Content-Type': 'application/json',
      'x-test-auth': 'token',
    });
  });

  it('uploads large imports directly without an S3 or record-count branch', async () => {
    const onFileUploading = vi.fn();
    const onStageChange = vi.fn();
    const onSuccess = vi.fn();
    const largeImport = {
      messages: Array.from({ length: 500 }, (_, index) => ({
        content: `message-${index}`,
        id: `message-${index}`,
        role: 'user',
      })),
      version: 1,
    };

    await new ServerService().importData(largeImport as any, {
      onFileUploading,
      onStageChange,
      onSuccess,
    });

    const request = MockXMLHttpRequest.instances[0];
    expect(request.method).toBe('POST');
    expect(request.url).toBe(
      '/webapi/data/import?expectedConversationVersion=7&strategy=merge',
    );
    expect(
      Object.entries(request.headers).find(([key]) => key.toLowerCase() === 'content-type')?.[1],
    ).toBe('application/json');
    expect(request.headers['x-test-auth']).toBe('token');
    expect(JSON.parse(request.body!)).toEqual(largeImport);
    expect(onStageChange.mock.calls.map(([stage]) => stage)).toEqual([
      ImportStage.Uploading,
      ImportStage.Importing,
      ImportStage.Success,
    ]);
    expect(onFileUploading).toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledWith({ messages: { added: 1 } }, expect.any(Number));
  });

  it('sends the explicit replace strategy for database backups', async () => {
    await new ServerService().importPgData(
      { data: {}, mode: 'pglite', schemaHash: 'hash' },
      { strategy: 'replace' },
    );

    expect(MockXMLHttpRequest.instances[0].url).toBe(
      '/webapi/data/import?expectedConversationVersion=7&strategy=replace',
    );
  });

  it('reports a server rollback response and never emits success', async () => {
    nextResponse = {
      body: JSON.stringify({
        code: 'IMPORT_FAILED_ROLLED_BACK',
        message: 'Import failed and all changes were rolled back.',
      }),
      status: 500,
    };
    const onError = vi.fn();
    const onStageChange = vi.fn();
    const onSuccess = vi.fn();

    await new ServerService().importData(
      { messages: [], version: 1 },
      { onError, onStageChange, onSuccess },
    );

    expect(onStageChange).toHaveBeenLastCalledWith(ImportStage.Error);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith({
      code: 'IMPORT_FAILED_ROLLED_BACK',
      httpStatus: 500,
      message: 'Import failed and all changes were rolled back.',
    });
  });

  it('reports a conversation version lookup failure before starting a request', async () => {
    const onError = vi.fn();
    const onStageChange = vi.fn();
    vi.mocked(messageService.getConversationVersion).mockRejectedValue(
      new Error('Version lookup failed'),
    );

    await new ServerService().importData(
      { messages: [], version: 1 },
      { onError, onStageChange },
    );

    expect(MockXMLHttpRequest.instances).toHaveLength(0);
    expect(onStageChange).toHaveBeenCalledWith(ImportStage.Error);
    expect(onError).toHaveBeenCalledWith({
      code: 'ImportError',
      httpStatus: 0,
      message: 'Version lookup failed',
    });
  });
});
