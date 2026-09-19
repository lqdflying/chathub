export class OpenAICodexTransientRefreshError extends Error {
  readonly httpStatus?: number;

  constructor(
    message = 'ChatGPT subscription refresh is temporarily unavailable.',
    httpStatus?: number,
  ) {
    super(message);
    this.name = 'OpenAICodexTransientRefreshError';
    this.httpStatus = httpStatus;
  }
}

export const isOpenAICodexTransientRefreshError = (
  error: unknown,
): error is OpenAICodexTransientRefreshError =>
  error instanceof OpenAICodexTransientRefreshError ||
  (error instanceof Error && error.name === 'OpenAICodexTransientRefreshError');
