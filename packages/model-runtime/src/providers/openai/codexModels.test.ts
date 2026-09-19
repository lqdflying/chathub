// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import {
  OPENAI_CODEX_FALLBACK_MODEL_IDS,
  buildCodexModelsHeaders,
  buildCodexModelsUrl,
  fetchOpenAICodexModels,
  normalizeCodexModelList,
} from './codexModels';

describe('codexModels', () => {
  it('pins the Codex CLI client_version on the catalog URL', () => {
    expect(buildCodexModelsUrl()).toBe(
      'https://chatgpt.com/backend-api/codex/models?client_version=0.154.0',
    );
    const headers = buildCodexModelsHeaders({ accessToken: 'tok', accountId: 'acct-review' });
    expect(
      new Request('https://chatgpt.com/backend-api/codex/models', { headers }).headers.get(
        'chatgpt-account-id',
      ),
    ).toBe('acct-review');
    expect(headers['ChatGPT-Account-ID']).toBeUndefined();
  });

  it('returns the live catalog when the fetch succeeds', async () => {
    const models = await fetchOpenAICodexModels({
      accessToken: 'tok',
      accountId: 'acct',
      fetchFn: vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ id: 'gpt-5.4' }, { id: 'o3' }] }),
      }),
    });

    expect(models.map((model) => model.id)).toEqual(expect.arrayContaining(['gpt-5.4', 'o3']));
  });

  it('normalizes live catalog shapes', () => {
    expect(normalizeCodexModelList({ data: [{ id: 'gpt-5.4' }, { slug: 'o3' }] })).toEqual([
      { id: 'gpt-5.4' },
      { id: 'o3' },
    ]);
  });

  it('falls back to the static subscription list when live fetch fails', async () => {
    const models = await fetchOpenAICodexModels({
      accessToken: 'tok',
      accountId: 'acct',
      fetchFn: vi.fn().mockRejectedValue(new Error('network')),
    });

    const ids = models.map((model) => model.id);
    for (const id of OPENAI_CODEX_FALLBACK_MODEL_IDS) {
      expect(ids).toContain(id);
    }
    expect(ids).not.toContain('gpt-5.6-luna');
  });
});
