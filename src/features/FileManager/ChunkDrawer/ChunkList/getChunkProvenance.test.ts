import { describe, expect, it } from 'vitest';

import { getChunkProvenance } from './ChunkItem';

describe('getChunkProvenance', () => {
  it('maps MarkItDown chunks to the MarkItDown label even when converted_by is set', () => {
    expect(getChunkProvenance('MarkItDownElement', 'markitdown')).toBe('MarkItDown');
  });

  it('maps LangChain chunks to the LangChain label', () => {
    expect(getChunkProvenance('LangChainElement', undefined)).toBe('LangChain');
  });

  it('falls back to converted_by for types outside the known map', () => {
    expect(getChunkProvenance('SomeOtherElement', 'markitdown')).toBe('markitdown');
  });

  it('shows the raw element type when no converted_by is present', () => {
    expect(getChunkProvenance('CompositeElement', undefined)).toBe('CompositeElement');
    expect(getChunkProvenance('Table', null)).toBe('Table');
  });

  it('returns an empty string when neither type nor converted_by is present', () => {
    expect(getChunkProvenance(undefined, undefined)).toBe('');
    expect(getChunkProvenance(null, null)).toBe('');
  });
});
