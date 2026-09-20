import GitHub from 'next-auth/providers/github';

import { authEnv } from '@/envs/auth';

import { CommonProviderConfig } from './sso.config';

/**
 * GitHub authorization-server identifier (RFC 9207 `iss`).
 * next-auth@5.0.0-beta.30's built-in GitHub provider omits `issuer`, so Auth.js
 * falls back to `https://authjs.dev` and rejects callbacks that now include
 * `iss=https://github.com/login/oauth`. This is GitHub's issuer, not APP_URL.
 * @see https://github.com/nextauthjs/next-auth/pull/13410
 */
export const GITHUB_OAUTH_ISSUER = 'https://github.com/login/oauth';

const provider = {
  id: 'github',
  provider: GitHub({
    ...CommonProviderConfig,
    // Specify auth scope, at least include 'openid email'
    authorization: { params: { scope: 'read:user user:email' } },
    // TODO(NextAuth ENVs Migration): Remove once nextauth envs migration time end
    clientId: authEnv.GITHUB_CLIENT_ID ?? process.env.AUTH_GITHUB_ID,
    clientSecret: authEnv.GITHUB_CLIENT_SECRET ?? process.env.AUTH_GITHUB_SECRET,
    // Remove end
    issuer: GITHUB_OAUTH_ISSUER,
    profile: (profile) => {
      return {
        email: profile.email,
        id: profile.id.toString(),
        image: profile.avatar_url,
        name: profile.name,
        providerAccountId: profile.id.toString(),
      };
    },
  }),
};

export default provider;
