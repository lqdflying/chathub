interface ResolveAsyncServerBaseUrlOptions {
  appUrl?: string;
  internalAppUrl?: string;
  isVercel?: boolean;
  localRewriteEnabled?: boolean;
  port?: string;
}

export type AsyncServerBaseUrlSource = 'app_url' | 'internal_app_url' | 'local_loopback';

export interface ResolvedAsyncServerBaseUrl {
  source: AsyncServerBaseUrlSource;
  url: string;
  warning?: 'invalid_internal_app_url' | 'missing_app_url';
}

const normalizeBaseUrl = (value: string) => value.trim().replace(/\/+$/, '');

const parseCleanHttpOrigin = (value: string): string | undefined => {
  try {
    const url = new URL(normalizeBaseUrl(value));
    const hasSupportedProtocol = url.protocol === 'http:' || url.protocol === 'https:';
    const hasCredentials = !!url.username || !!url.password;
    const hasPath = url.pathname !== '/';

    if (!hasSupportedProtocol || hasCredentials || hasPath || url.search || url.hash) {
      return undefined;
    }

    return url.origin;
  } catch {
    return undefined;
  }
};

export const resolveAsyncServerBaseUrl = ({
  appUrl,
  internalAppUrl,
  isVercel = process.env.VERCEL === '1',
  localRewriteEnabled,
  port = process.env.PORT || '3210',
}: ResolveAsyncServerBaseUrlOptions): ResolvedAsyncServerBaseUrl => {
  const explicitInternalUrl = internalAppUrl?.trim();
  const internalOrigin = explicitInternalUrl
    ? parseCleanHttpOrigin(explicitInternalUrl)
    : undefined;

  if (internalOrigin) {
    return {
      source: 'internal_app_url',
      url: internalOrigin,
    };
  }

  const warning = explicitInternalUrl ? 'invalid_internal_app_url' : undefined;

  if (localRewriteEnabled && !isVercel) {
    return {
      source: 'local_loopback',
      url: `http://127.0.0.1:${port || '3210'}`,
      warning,
    };
  }

  if (appUrl) {
    return {
      source: 'app_url',
      url: normalizeBaseUrl(appUrl),
      warning,
    };
  }

  return {
    source: 'app_url',
    url: '',
    warning: warning || 'missing_app_url',
  };
};
