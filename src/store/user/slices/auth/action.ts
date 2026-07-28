import { StateCreator } from 'zustand/vanilla';

import { enableAuth, enableClerk, enableNextAuth } from '@/const/auth';
import { normalizeAuthRedirect } from '@/helpers/normalizeAuthRedirect';
import { runRedirectingNextAuthSessionTransition } from '@/libs/next-auth/sessionLifecycle';

import type { UserStore } from '../../store';

const NEXT_AUTH_SIGN_IN_PATH = '/next-auth/signin';
const NEXT_AUTH_SIGN_OUT_REDIRECT = '/next-auth/signin';

export interface UserAuthAction {
  enableAuth: () => boolean;
  /**
   * universal logout method
   */
  logout: () => Promise<void>;
  /**
   * universal login method
   */
  openLogin: () => Promise<void>;
}

export const createAuthSlice: StateCreator<
  UserStore,
  [['zustand/devtools', never]],
  [],
  UserAuthAction
> = (set, get) => ({
  enableAuth: () => {
    return enableAuth;
  },
  logout: async () => {
    if (enableClerk) {
      get().clerkSignOut?.({ redirectUrl: location.toString() });

      return;
    }

    if (enableNextAuth) {
      const { signOut } = await import('next-auth/react');
      const result = await runRedirectingNextAuthSessionTransition(() =>
        signOut({ redirect: false, redirectTo: NEXT_AUTH_SIGN_OUT_REDIRECT }),
      );
      window.location.assign(normalizeAuthRedirect(result?.url, NEXT_AUTH_SIGN_OUT_REDIRECT));
    }
  },
  openLogin: async () => {
    if (enableClerk) {
      const redirectUrl = location.toString();
      get().clerkSignIn?.({
        fallbackRedirectUrl: redirectUrl,
        signUpForceRedirectUrl: redirectUrl,
        signUpUrl: '/signup',
      });

      return;
    }

    if (enableNextAuth) {
      const { signIn } = await import('next-auth/react');
      // Check if only one provider is available
      const providers = get()?.oAuthSSOProviders;

      // Always show signin page when credentials provider is enabled (needs form)
      const hasCredentials = providers?.includes('credentials');
      if (hasCredentials) {
        const callbackUrl = `${location.pathname}${location.search}${location.hash}` || '/';
        const signInUrl = new URL(NEXT_AUTH_SIGN_IN_PATH, location.origin);
        signInUrl.searchParams.set('callbackUrl', callbackUrl);
        window.location.assign(`${signInUrl.pathname}${signInUrl.search}`);
        return;
      }

      if (providers && providers.length === 1) {
        await runRedirectingNextAuthSessionTransition(() => signIn(providers[0]));
        return;
      }
      await signIn();
    }
  },
});
