import { describe, expect, it } from 'vitest';

import { dalleMissingImageKey, resolveDalleRenderItems } from './resolveItems';

describe('resolveDalleRenderItems', () => {
  it('falls back to the content prop when the store has no message', () => {
    expect(resolveDalleRenderItems([{ prompt: 'p' }], undefined, 'm1')).toEqual([
      { messageId: 'm1', prompt: 'p' },
    ]);
  });

  it('prefers live store imageId over stale prompt-only props', () => {
    const items = resolveDalleRenderItems([{ prompt: 'p' }], {
      content: JSON.stringify([{ imageId: 'file-live', prompt: 'p' }]),
    }, 'm1');
    expect(items[0]?.imageId).toBe('file-live');
  });

  it('fills imageId from message imageList when content is prompt-only', () => {
    const items = resolveDalleRenderItems([{ prompt: 'p' }], {
      content: JSON.stringify([{ prompt: 'p' }]),
      imageList: [{ alt: 'p', id: 'file-linked', url: '' }],
    }, 'm1');
    expect(items[0]?.imageId).toBe('file-linked');
  });

  it('does not attach a compact imageList onto the wrong tile', () => {
    const items = resolveDalleRenderItems([{ prompt: 'a' }, { prompt: 'b' }], {
      content: JSON.stringify([{ prompt: 'a' }, { prompt: 'b' }]),
      imageList: [{ alt: 'b', id: 'file-b', url: '' }],
    }, 'm1');
    expect(items[0]?.imageId).toBeUndefined();
    expect(items[1]?.imageId).toBeUndefined();
  });

  it('returns an empty list for non-array content', () => {
    expect(resolveDalleRenderItems({ prompts: ['p'] }, undefined, 'm1')).toEqual([]);
  });
});

describe('dalleMissingImageKey', () => {
  it('fingerprints which tiles still lack a file', () => {
    expect(dalleMissingImageKey([{ imageId: 'a' }, { prompt: 'p' } as never])).toBe('10');
  });
});
