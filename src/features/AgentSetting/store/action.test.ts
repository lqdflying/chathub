import { beforeEach, describe, expect, it } from 'vitest';

import { createStore } from './index';

type AnyStore = ReturnType<typeof createStore>;

const makeStore = (): AnyStore => {
  const store = createStore();
  // The streaming handlers read the rest of the store via get() but never
  // rely on data beyond `dispatchMeta`, so default state is enough.
  return store;
};

describe('AgentSetting store — summary output sanitisation', () => {
  let store: AnyStore;
  beforeEach(() => {
    store = makeStore();
  });

  describe('streamUpdateMetaString', () => {
    it('strips the `输出:` prefix that some models echo back', () => {
      const handler = store.getState().streamUpdateMetaString('description');

      handler({ type: 'text', text: '输出: ' });
      handler({ type: 'text', text: 'Azure 公有云合规文档专家' });

      expect(store.getState().meta.description).toBe('Azure 公有云合规文档专家');
    });

    it('drops the echoed `输入: {...} [locale]` block and keeps only the answer', () => {
      const handler = store.getState().streamUpdateMetaString('description');

      const raw =
        '输入: {"You are an Azure public cloud specialist…"} [en-US]\n' +
        '输出: Azure public cloud compliance & documentation specialist';

      handler({ type: 'text', text: raw });

      expect(store.getState().meta.description).toBe(
        'Azure public cloud compliance & documentation specialist',
      );
    });

    it('caps description length at 1000 chars to match the DB column', () => {
      const handler = store.getState().streamUpdateMetaString('description');

      handler({ type: 'text', text: 'x'.repeat(2000) });

      expect(store.getState().meta.description?.length).toBe(1000);
    });

    it('passes clean answers through unchanged', () => {
      const handler = store.getState().streamUpdateMetaString('title');

      handler({ type: 'text', text: 'AzureTruth' });

      expect(store.getState().meta.title).toBe('AzureTruth');
    });
  });

  describe('streamUpdateMetaArray', () => {
    it('strips the `输出:` prefix from the first tag', () => {
      const handler = store.getState().streamUpdateMetaArray('tags');

      handler({
        type: 'text',
        text: '输出: azure,documentation,tooling-protocol,architecture-guidance,security-iac',
      });

      expect(store.getState().meta.tags).toEqual([
        'azure',
        'documentation',
        'tooling-protocol',
        'architecture-guidance',
        'security-iac',
      ]);
    });

    it('caps tag count at 5, trims whitespace, and dedupes', () => {
      const handler = store.getState().streamUpdateMetaArray('tags');

      handler({
        type: 'text',
        text: ' azure , azure , docs , iac , security , compliance , extra ',
      });

      expect(store.getState().meta.tags).toEqual([
        'azure',
        'docs',
        'iac',
        'security',
        'compliance',
      ]);
    });

    it('supports full-width commas produced by some CN models', () => {
      const handler = store.getState().streamUpdateMetaArray('tags');

      handler({ type: 'text', text: '输出：azure，documentation，security' });

      expect(store.getState().meta.tags).toEqual(['azure', 'documentation', 'security']);
    });
  });
});
