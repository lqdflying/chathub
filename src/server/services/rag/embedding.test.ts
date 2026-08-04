import { afterEach, describe, expect, it, vi } from 'vitest';

import { UserModel } from '@/database/models/user';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import {
  RagEmbeddingProviderError,
  RagEmbeddingService,
  RagKeyVaultsUnreadableError,
  getRagFingerprint,
  getRagUserKeyVaults,
  mergeBrowserKeyVaultsPreservingRag,
  mergeRagProviderUpdate,
} from './embedding';

const vector = Array.from({ length: 1024 }, (_, index) => index / 1024);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('RAG key vault reads', () => {
  it('rejects unreadable ciphertext instead of returning an empty vault', async () => {
    vi.spyOn(KeyVaultsGateKeeper, 'initWithEnvKey').mockResolvedValue({
      decrypt: vi.fn().mockResolvedValue({ plaintext: '', wasAuthentic: false }),
    } as any);
    vi.spyOn(UserModel, 'getUserApiKeys').mockImplementation(async (_db, _userId, decryptor) =>
      decryptor('encrypted'),
    );

    await expect(getRagUserKeyVaults({} as any, 'user-1')).rejects.toBeInstanceOf(
      RagKeyVaultsUnreadableError,
    );
  });

  it('preserves the server RAG entry and ignores a browser replacement', () => {
    const serverRag = {
      apiKey: 'server-key',
      model: 'text-embedding-3-small',
      provider: 'openai' as const,
    };

    expect(
      mergeBrowserKeyVaultsPreservingRag(
        { rag: serverRag },
        {
          openai: { apiKey: 'browser-key' },
          rag: { apiKey: 'injected', model: 'other', provider: 'voyage' },
        },
      ),
    ).toEqual({ openai: { apiKey: 'browser-key' }, rag: serverRag });
  });
});

describe('RagEmbeddingService', () => {
  it('calls an OpenAI-compatible embeddings endpoint with 1024 dimensions', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ embedding: vector, index: 0 }] }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const service = new RagEmbeddingService({
      apiKey: 'secret',
      baseURL: 'https://rag.example.test/v1/',
      model: 'text-embedding-3-small',
      provider: 'openai',
    });
    await expect(service.embed('hello', 'query')).resolves.toEqual([vector]);

    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('https://rag.example.test/v1/embeddings');
    expect(JSON.parse(request.body)).toMatchObject({
      dimensions: 1024,
      input: ['hello'],
      model: 'text-embedding-3-small',
    });
    expect(request.headers.Authorization).toBe('Bearer secret');
  });

  it('maps query and document inputs to the Cohere v2 API', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ embeddings: { float: [vector] } }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const service = new RagEmbeddingService({
      apiKey: 'cohere-key',
      model: 'embed-multilingual-v3.0',
      provider: 'cohere',
    });
    await service.embed(['question'], 'query');

    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.cohere.com/v2/embed');
    expect(JSON.parse(request.body)).toMatchObject({
      embedding_types: ['float'],
      input_type: 'search_query',
      texts: ['question'],
    });
  });

  it('requests a 1024-dimensional Voyage vector', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: [{ embedding: vector }] }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const service = new RagEmbeddingService({
      apiKey: 'voyage-key',
      model: 'voyage-3.5',
      provider: 'voyage',
    });
    await service.embed('document', 'document');

    const [, request] = fetchMock.mock.calls[0];
    expect(JSON.parse(request.body)).toMatchObject({
      input_type: 'document',
      output_dimension: 1024,
    });
  });

  it('rejects providers that return a different vector dimension', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: [{ embedding: [0, 1], index: 0 }] }), {
          status: 200,
        }),
      ),
    );

    const service = new RagEmbeddingService({
      apiKey: 'secret',
      model: 'wrong-dimension-model',
      provider: 'openai',
    });
    await expect(service.embed('hello')).rejects.toBeInstanceOf(RagEmbeddingProviderError);
  });

  it('rejects vectors containing non-numeric values', async () => {
    const invalidVector = [...vector] as any[];
    invalidVector[0] = null;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: [{ embedding: invalidVector, index: 0 }] }), {
          status: 200,
        }),
      ),
    );

    const service = new RagEmbeddingService({
      apiKey: 'secret',
      model: 'invalid-vector-model',
      provider: 'openai',
    });
    await expect(service.embed('hello')).rejects.toBeInstanceOf(RagEmbeddingProviderError);
  });

  it('reports a controlled error for a malformed provider payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ data: { embedding: vector } }), { status: 200 }),
        ),
    );

    const service = new RagEmbeddingService({
      apiKey: 'secret',
      model: 'malformed-response-model',
      provider: 'openai',
    });
    await expect(service.embed('hello')).rejects.toMatchObject({
      code: 'RAG_PROVIDER_ERROR',
      message: 'The embedding provider returned an invalid vector count.',
    });
  });
});

describe('RAG provider identity', () => {
  it('does not include credentials or URL secrets in the fingerprint', () => {
    const fingerprint = getRagFingerprint({
      apiKey: 'top-secret',
      baseURL: 'https://user:password@rag.example.test/v1/?token=secret',
      model: 'model-a',
      provider: 'openai',
    });
    expect(fingerprint).toMatch(/^rag:[\da-f]{64}$/);
    expect(fingerprint).not.toContain('secret');
    expect(fingerprint).not.toContain('password');
    expect(fingerprint).toBe(
      getRagFingerprint({
        apiKey: 'rotated-key',
        baseURL: 'https://rag.example.test/v1',
        model: 'model-a',
        provider: 'openai',
      }),
    );
  });

  it('retains a saved API key when an update leaves it blank', () => {
    expect(
      mergeRagProviderUpdate(
        { apiKey: 'saved', model: 'old', provider: 'openai' },
        { apiKey: '', baseURL: '', model: 'new', provider: 'openai' },
      ),
    ).toEqual({ apiKey: 'saved', model: 'new', provider: 'openai' });
  });

  it('requires a new API key when the provider changes', () => {
    expect(() =>
      mergeRagProviderUpdate(
        { apiKey: 'openai-key', model: 'old', provider: 'openai' },
        { apiKey: '', baseURL: '', model: 'embed-v4.0', provider: 'cohere' },
      ),
    ).toThrow('provider, model, and API key');
  });
});
