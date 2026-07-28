const AUTH_JS_SESSION_COOKIE_NAME = /^(?:__Secure-)?authjs\.session-token(?:\.\d+)?$/;

const isAuthJsSessionCookie = (setCookieHeader: string): boolean => {
  const nameSeparatorIndex = setCookieHeader.indexOf('=');
  if (nameSeparatorIndex < 0) return false;

  const cookieName = setCookieHeader.slice(0, nameSeparatorIndex).trim();
  return AUTH_JS_SESSION_COOKIE_NAME.test(cookieName);
};

export const stripAuthJsSessionCookies = <ResponseType extends Response>(
  response: ResponseType,
): ResponseType => {
  const setCookieHeaders = response.headers.getSetCookie();
  const preservedSetCookieHeaders = setCookieHeaders.filter(
    (setCookieHeader) => !isAuthJsSessionCookie(setCookieHeader),
  );

  if (preservedSetCookieHeaders.length === setCookieHeaders.length) return response;

  response.headers.delete('set-cookie');
  for (const setCookieHeader of preservedSetCookieHeaders) {
    response.headers.append('set-cookie', setCookieHeader);
  }

  return response;
};
