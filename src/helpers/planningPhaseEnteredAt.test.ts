import { describe, expect, it } from 'vitest';

import {
  attachPlanningPhaseEnteredAt,
  readPlanningPhaseEnteredAtFromConfig,
  resolveSyncedPlanningPhaseEnteredAt,
} from './planningPhaseEnteredAt';

describe('planningPhaseEnteredAt', () => {
  it('reads the persisted config clock', () => {
    expect(
      readPlanningPhaseEnteredAtFromConfig({ planningPhaseEnteredAt: '2026-09-18T08:00:00.000Z' }),
    ).toBe('2026-09-18T08:00:00.000Z');
    expect(readPlanningPhaseEnteredAtFromConfig({})).toBeUndefined();
  });

  it('exposes phaseEnteredAt from config or the latest planning snapshot', () => {
    const [fromConfig, fromEvent, otherPhase] = attachPlanningPhaseEnteredAt(
      [
        {
          config: { planningPhaseEnteredAt: '2026-09-18T08:00:00.000Z' },
          id: 'cgo_config',
          phase: 'planning',
        },
        { config: {}, id: 'cgo_event', phase: 'planning' },
        {
          config: { planningPhaseEnteredAt: '2026-09-18T08:00:00.000Z' },
          id: 'cgo_model',
          phase: 'model',
        },
      ],
      new Map([['cgo_event', '2026-09-18T07:59:00.000Z']]),
    );

    expect(fromConfig.phaseEnteredAt).toBe('2026-09-18T08:00:00.000Z');
    expect(fromEvent.phaseEnteredAt).toBe('2026-09-18T07:59:00.000Z');
    expect(otherPhase.phaseEnteredAt).toBeUndefined();
  });

  it('prefers the API clock and never invents one from heartbeat updatedAt', () => {
    expect(
      resolveSyncedPlanningPhaseEnteredAt({
        attached: {
          operationId: 'cgo_one',
          phase: 'planning',
          phaseEnteredAt: '2026-09-18T08:00:00.000Z',
        },
        operation: {
          id: 'cgo_one',
          phase: 'planning',
          phaseEnteredAt: '2026-09-18T08:00:00.000Z',
        },
      }),
    ).toBe('2026-09-18T08:00:00.000Z');

    expect(
      resolveSyncedPlanningPhaseEnteredAt({
        attached: {
          operationId: 'cgo_one',
          phase: 'planning',
          phaseEnteredAt: '2026-09-18T08:00:00.000Z',
        },
        operation: { id: 'cgo_one', phase: 'planning', phaseEnteredAt: undefined },
      }),
    ).toBe('2026-09-18T08:00:00.000Z');

    expect(
      resolveSyncedPlanningPhaseEnteredAt({
        operation: { id: 'cgo_one', phase: 'planning', phaseEnteredAt: undefined },
      }),
    ).toBeUndefined();
  });
});
