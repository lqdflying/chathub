/**
 * Normalize an error for `updatePluginState({ error })` persistence.
 *
 * A raw `Error` survives the trip to the server (superjson rehydrates it as a
 * real `Error`), but the jsonb column write then `JSON.stringify`s it and an
 * Error's `message` is own-but-non-enumerable — so only `{"name": "..."}` is
 * stored and the UI can never show the actual failure. Store a plain object
 * instead, keeping the TRPC detail (`data.code` / `data.httpStatus`) while the
 * client-side error shape is still intact.
 */
export const serializePluginError = (error: unknown) => {
  if (error instanceof Error) {
    const data = (error as { data?: { code?: string; httpStatus?: number } }).data;
    return {
      code: data?.code,
      message: error.message,
      name: error.name,
      status: data?.httpStatus,
    };
  }
  return error;
};
