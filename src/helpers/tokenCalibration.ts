/** Bump when the uncalibrated counter changes so old ratios are not reused. */
export const ESTIMATOR_REVISION = 1;

export const CALIBRATION_MIN_SAMPLES = 8;
export const CALIBRATION_ALPHA = 0.1;
export const CALIBRATION_MIN_MULTIPLIER = 0.6;
export const CALIBRATION_MAX_MULTIPLIER = 1.8;

export interface TokenCalibrationState {
  ewma: number;
  samples: number;
}

const clampMultiplier = (value: number): number =>
  Math.min(CALIBRATION_MAX_MULTIPLIER, Math.max(CALIBRATION_MIN_MULTIPLIER, value));

/** actual / uncalibrated, clamped. Undefined when the pair cannot train a ratio. */
export const calibrationRatio = (actual: number, uncalibrated: number): number | undefined => {
  if (!Number.isFinite(actual) || !Number.isFinite(uncalibrated) || actual <= 0 || uncalibrated <= 0) {
    return undefined;
  }
  return clampMultiplier(actual / uncalibrated);
};

export const nextTokenCalibrationState = (
  previous: TokenCalibrationState | undefined,
  ratio: number,
): TokenCalibrationState => {
  const samples = (previous?.samples ?? 0) + 1;
  const ewma = previous
    ? previous.ewma * (1 - CALIBRATION_ALPHA) + ratio * CALIBRATION_ALPHA
    : ratio;
  return { ewma: clampMultiplier(ewma), samples };
};

/** One until enough eligible requests have been observed. */
export const tokenCalibrationMultiplier = (state?: TokenCalibrationState): number =>
  state && state.samples >= CALIBRATION_MIN_SAMPLES && Number.isFinite(state.ewma)
    ? clampMultiplier(state.ewma)
    : 1;

export const scaleLocalTokens = (tokens: number, multiplier: number): number => {
  if (!Number.isFinite(tokens) || tokens === 0) return 0;
  const factor = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
  return Math.ceil(tokens * factor);
};
