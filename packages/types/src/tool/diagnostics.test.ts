import { describe, expect, it } from 'vitest';

import { createToolCallSetCorrelation, createToolResultDebugSummary } from './diagnostics';

describe('tool diagnostics', () => {
  it('creates the same correlation for reordered and duplicated tool-call IDs', () => {
    const firstCorrelation = createToolCallSetCorrelation(['tool-b', 'tool-a', 'tool-b']);
    const secondCorrelation = createToolCallSetCorrelation(['tool-a', 'tool-b']);

    expect(firstCorrelation).toEqual(secondCorrelation);
    expect(firstCorrelation).toMatchObject({
      toolCallCount: 2,
      toolCallSetHash: expect.stringMatching(/^[\da-f]{16}$/),
    });
  });

  it('bounds result fingerprints while preserving the original value type', () => {
    const summary = createToolResultDebugSummary('x'.repeat(40_000));

    expect(summary).toMatchObject({
      serializedLength: 32_768,
      truncated: true,
      type: 'string',
      valueHash: expect.stringMatching(/^[\da-f]{16}$/),
    });
  });
});
