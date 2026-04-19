import type { NextAuthConfig } from 'next-auth';

import { getServerDBConfig } from '@/config/db';
import { serverDB } from '@/database/server';
import { getAuthConfig } from '@/envs/auth';
import { NextAuthUserService } from '@/server/services/nextAuthUser';

import { parseAuthProviders } from './parseAuthProviders';
import { LobeNextAuthDbAdapter } from './adapter';
import { ssoProviders } from './sso-providers';

const {
  AUTH_SESSION_MAX_AGE_DAYS,
  NEXT_AUTH_DEBUG,
  NEXT_AUTH_SECRET,
  NEXT_AUTH_SSO_SESSION_STRATEGY,
  NEXT_AUTH_SSO_PROVIDERS,
  NEXT_PUBLIC_ENABLE_NEXT_AUTH,
} = getAuthConfig();

const { NEXT_PUBLIC_ENABLED_SERVER_SERVICE } = getServerDBConfig();

export const initSSOProviders = () => {
  return NEXT_PUBLIC_ENABLE_NEXT_AUTH
    ? parseAuthProviders(NEXT_AUTH_SSO_PROVIDERS).map((provider) => {
        const validProvider = ssoProviders.find((item) => item.id === provider);

        if (validProvider) return validProvider.provider;

        throw new Error(`[NextAuth] provider ${provider} is not supported`);
      })
    : [];
};

const hasCredentialsProvider = () => {
  return parseAuthProviders(NEXT_AUTH_SSO_PROVIDERS).includes('credentials');
};

// Notice this is only an object, not a full Auth.js instance
export default {
  adapter: NEXT_PUBLIC_ENABLED_SERVER_SERVICE ? LobeNextAuthDbAdapter() : undefined,
  callbacks: {
    // Note: Data processing order of callback: authorize --> jwt --> session
    async jwt({ token, user }) {
      // ref: https://authjs.dev/guides/extending-the-session#with-jwt
      if (user?.id) {
        token.userId = user?.id;
      }
      if (user?.image) {
        token.picture = user.image;
      }
      return token;
    },
    async session({ session, token, user }) {
      if (session.user) {
        // ref: https://authjs.dev/guides/extending-the-session#with-database
        if (user) {
          session.user.id = user.id;
          if (user.image) {
            session.user.image = user.image;
          }
        } else {
          session.user.id = (token.userId ?? session.user.id) as string;
          if (token.picture) {
            session.user.image = token.picture as string;
          }
        }
      }
      return session;
    },
  },
  debug: NEXT_AUTH_DEBUG,
  pages: {
    error: '/next-auth/error',
    signIn: '/next-auth/signin',
  },
  providers: initSSOProviders(),
  secret: NEXT_AUTH_SECRET,
  session: {
    maxAge: AUTH_SESSION_MAX_AGE_DAYS * 24 * 60 * 60,
    // Credentials provider only supports JWT strategy
    // Also force JWT if server service is disabled
    strategy:
      hasCredentialsProvider() || !NEXT_PUBLIC_ENABLED_SERVER_SERVICE
        ? 'jwt'
        : NEXT_AUTH_SSO_SESSION_STRATEGY,
  },
  trustHost: process.env?.AUTH_TRUST_HOST ? process.env.AUTH_TRUST_HOST === 'true' : true,
  events: {
    async signIn({ user, profile }) {
      if (!NEXT_PUBLIC_ENABLED_SERVER_SERVICE || !user?.id) return;

      const image =
        user.image ||
        (profile &&
        typeof profile === 'object' &&
        'avatar_url' in profile &&
        typeof (profile as { avatar_url?: string }).avatar_url === 'string'
          ? (profile as { avatar_url: string }).avatar_url
          : undefined);
      const name =
        user.name ||
        (profile &&
        typeof profile === 'object' &&
        'name' in profile &&
        typeof (profile as { name?: string }).name === 'string'
          ? (profile as { name: string }).name
          : undefined);

      if (!image && !name) return;

      try {
        const svc = new NextAuthUserService(serverDB);
        await svc.syncOAuthProfileOnSignIn(user.id, { image, name });
      } catch {
        /* non-fatal — do not block sign-in */
      }
    },
  },
} satisfies NextAuthConfig;
