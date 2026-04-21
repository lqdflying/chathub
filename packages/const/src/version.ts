import pkg from '@/../package.json';

import { BRANDING_NAME, ORG_NAME } from './branding';

/** Optional release label baked at Docker/CI build (e.g. git tag `v3.4.38-canary.1`). */
const tagFromEnv = process.env.NEXT_PUBLIC_APP_TAG?.trim();
const normalizedTag =
  tagFromEnv && tagFromEnv.startsWith('v') ? tagFromEnv.slice(1) : tagFromEnv;

export const CURRENT_VERSION = normalizedTag || pkg.version;

export const isServerMode = process.env.NEXT_PUBLIC_SERVICE_MODE === 'server';
export const isUsePgliteDB = process.env.NEXT_PUBLIC_CLIENT_DB === 'pglite';

export const isDesktop = process.env.NEXT_PUBLIC_IS_DESKTOP_APP === '1';

export const isDeprecatedEdition = !isServerMode && !isUsePgliteDB;

// @ts-ignore
export const isCustomBranding = BRANDING_NAME !== 'LobeHub';
// @ts-ignore
export const isCustomORG = ORG_NAME !== 'LobeHub';
