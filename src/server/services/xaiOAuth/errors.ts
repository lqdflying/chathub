export class XaiOAuthTransientRefreshError extends Error {
  readonly httpStatus: number;

  constructor(message: string, httpStatus = 0) {
    super(message);
    this.name = 'XaiOAuthTransientRefreshError';
    this.httpStatus = httpStatus;
  }
}

export const isXaiOAuthTransientRefreshError = (
  error: unknown,
): error is XaiOAuthTransientRefreshError => error instanceof XaiOAuthTransientRefreshError;
