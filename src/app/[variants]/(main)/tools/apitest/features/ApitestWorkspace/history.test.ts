import { beforeEach, describe, expect, it } from 'vitest';

import {
  type ApiTesterHistoryEntry,
  HISTORY_LIMIT,
  HISTORY_STORAGE_KEY,
  appendHistoryEntry,
  loadHistory,
  saveHistory,
} from './history';
import { createEmptyDraft } from './types';

const makeEntry = (id: string): ApiTesterHistoryEntry => ({
  createdAt: 1_700_000_000_000,
  id,
  request: { ...createEmptyDraft(), method: 'GET', url: `https://example.com/${id}` },
  response: { size: 10, status: 200, time: 42 },
});

describe('appendHistoryEntry', () => {
  it('prepends the new entry', () => {
    const list = appendHistoryEntry([makeEntry('a')], makeEntry('b'));
    expect(list.map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('caps the list at the limit', () => {
    let list: ApiTesterHistoryEntry[] = [];
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) {
      list = appendHistoryEntry(list, makeEntry(`e${i}`));
    }
    expect(list).toHaveLength(HISTORY_LIMIT);
    expect(list[0].id).toBe(`e${HISTORY_LIMIT + 4}`);
  });
});

describe('loadHistory / saveHistory', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns [] when nothing is stored', () => {
    expect(loadHistory()).toEqual([]);
  });

  it('round-trips entries', () => {
    const entries = [makeEntry('a'), makeEntry('b')];
    saveHistory(entries);
    expect(loadHistory()).toEqual(entries);
  });

  it('returns [] on corrupt JSON', () => {
    localStorage.setItem(HISTORY_STORAGE_KEY, '{not json');
    expect(loadHistory()).toEqual([]);
  });

  it('returns [] when the stored value is not an array', () => {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify({ nope: true }));
    expect(loadHistory()).toEqual([]);
  });

  it('filters out malformed entries', () => {
    const good = makeEntry('good');
    localStorage.setItem(
      HISTORY_STORAGE_KEY,
      JSON.stringify([good, { id: 'bad' }, null, 'string']),
    );
    expect(loadHistory()).toEqual([good]);
  });
});
