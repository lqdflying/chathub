import { TokenEstimationModel } from '@/database/models/tokenEstimation';
import { LobeChatDatabase } from '@/database/type';
import {
  ESTIMATOR_REVISION,
  calibrationRatio,
  nextTokenCalibrationState,
  tokenCalibrationMultiplier,
} from '@/helpers/tokenCalibration';

export class TokenEstimationService {
  private model: TokenEstimationModel;

  constructor(db: LobeChatDatabase, userId: string) {
    this.model = new TokenEstimationModel(db, userId);
  }

  getMultiplier = async (provider: string, model: string): Promise<number> => {
    const row = await this.model.find(provider, model, ESTIMATOR_REVISION);
    return tokenCalibrationMultiplier(row ? { ewma: row.ewma, samples: row.samples } : undefined);
  };

  /** Ignore ineligible or non-finite pairs. Stores only the numeric EWMA. */
  observe = async ({
    actualInputTokens,
    eligible,
    model,
    provider,
    uncalibratedInputTokens,
  }: {
    actualInputTokens: number;
    eligible: boolean;
    model: string;
    provider: string;
    uncalibratedInputTokens: number;
  }): Promise<void> => {
    if (!eligible || !provider || !model) return;
    const ratio = calibrationRatio(actualInputTokens, uncalibratedInputTokens);
    if (ratio === undefined) return;

    const current = await this.model.find(provider, model, ESTIMATOR_REVISION);
    const next = nextTokenCalibrationState(
      current ? { ewma: current.ewma, samples: current.samples } : undefined,
      ratio,
    );
    await this.model.save({
      estimatorRevision: ESTIMATOR_REVISION,
      ewma: next.ewma,
      model,
      provider,
      samples: next.samples,
    });
  };
}
