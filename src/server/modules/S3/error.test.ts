import { describe, expect, it } from 'vitest';

import { isStorageObjectMissingError } from './error';

describe('isStorageObjectMissingError', () => {
  it.each([
    { Code: 'NoSuchKey' },
    { code: 'NotFound' },
    { name: 'NoSuchObject' },
    { $metadata: { httpStatusCode: 404 } },
  ])('recognizes missing-object errors', (error) => {
    expect(isStorageObjectMissingError(error)).toBe(true);
  });

  it.each([new Error('network failure'), { $metadata: { httpStatusCode: 500 } }, null])(
    'does not classify other failures as missing objects',
    (error) => {
      expect(isStorageObjectMissingError(error)).toBe(false);
    },
  );
});
