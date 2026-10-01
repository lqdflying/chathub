import { describe, expect, it } from 'vitest';

import {
  CALIBRATION_MAX_MULTIPLIER,
  CALIBRATION_MIN_MULTIPLIER,
  CALIBRATION_MIN_SAMPLES,
  calibrationRatio,
  nextTokenCalibrationState,
  scaleLocalTokens,
  tokenCalibrationMultiplier,
} from './tokenCalibration';

describe('token calibration', () => {
  it('clamps ratios on both sides and stays at 1 until enough samples', () => {
    expect(calibrationRatio(100, 10)).toBe(CALIBRATION_MAX_MULTIPLIER);
    expect(calibrationRatio(10, 100)).toBe(CALIBRATION_MIN_MULTIPLIER);
    expect(calibrationRatio(0, 10)).toBeUndefined();

    let state = nextTokenCalibrationState(undefined, 1.5);
    expect(tokenCalibrationMultiplier(state)).toBe(1);
    for (let sample = 1; sample < CALIBRATION_MIN_SAMPLES; sample += 1) {
      state = nextTokenCalibrationState(state, 1.5);
    }
    expect(state.samples).toBe(CALIBRATION_MIN_SAMPLES);
    expect(tokenCalibrationMultiplier(state)).toBeGreaterThan(1);
    expect(tokenCalibrationMultiplier(state)).toBeLessThanOrEqual(CALIBRATION_MAX_MULTIPLIER);
  });

  it('scales only the local count', () => {
    expect(scaleLocalTokens(10, 1.2)).toBe(12);
    expect(scaleLocalTokens(0, 1.8)).toBe(0);
    expect(scaleLocalTokens(-4, 0.5)).toBe(-2);
  });
});
