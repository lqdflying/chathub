import pkg from '@/../package.json';

import { BRANDING_NAME, ORG_NAME } from './branding';

/** Optional release label baked at Docker/CI build (e.g. git tag `v3.4.38-canary.1`). */
const tagFromEnv = process.env.NEXT_PUBLIC_APP_TAG?.trim();
const normalizedTag =
  tagFromEnv && tagFromEnv.startsWith('v') ? tagFromEnv.slice(1) : tagFromEnv;

export const CURRENT_VERSION = normalizedTag || pkg.version;

// @ts-ignore
export const isCustomBranding = BRANDING_NAME !== 'ChatHub';
// @ts-ignore
export const isCustomORG = ORG_NAME !== 'ChatHub';
