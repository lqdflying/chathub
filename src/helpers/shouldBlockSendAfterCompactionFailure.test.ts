import { describe, expect, it } from 'vitest';

import { shouldBlockSendAfterCompactionFailure } from './shouldBlockSendAfterCompactionFailure';

describe('shouldBlockSendAfterCompactionFailure', () => {
  it('blocks failed compact while still at/above the high watermark', () => {
    expect(
      shouldBlockSendAfterCompactionFailure(
        {
          estimatedTokensBefore: 900_000,
          highWatermark: 0.8,
          status: 'failed',
        },
        1_048_576,
      ),
    ).toBe(true);
  });

  it('allows send when failed compact already dropped below the watermark', () => {
    expect(
      shouldBlockSendAfterCompactionFailure(
        {
          estimatedTokensBefore: 100_000,
          highWatermark: 0.8,
          status: 'failed',
        },
        1_048_576,
      ),
    ).toBe(false);
  });

  it('blocks target_unreachable at the ceiling', () => {
    expect(
      shouldBlockSendAfterCompactionFailure(
        {
          estimatedTokensBefore: 1_048_570,
          highWatermark: 0.8,
          status: 'target_unreachable',
        },
        1_048_576,
      ),
    ).toBe(true);
  });

  it('does not block successful or not_needed outcomes', () => {
    expect(
      shouldBlockSendAfterCompactionFailure({ status: 'enqueued', reason: 'durable_enqueued' }, 1000),
    ).toBe(false);
    expect(
      shouldBlockSendAfterCompactionFailure(
        { status: 'not_needed', reason: 'below_high_watermark' },
        1000,
      ),
    ).toBe(false);
  });

  it('blocks failed compact when estimate fields are missing', () => {
    expect(shouldBlockSendAfterCompactionFailure({ status: 'failed' }, 1000)).toBe(true);
  });
});
