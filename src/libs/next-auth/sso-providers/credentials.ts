import Credentials from 'next-auth/providers/credentials';

/**
 * Constant-time string comparison to prevent timing attacks.
 * Uses TextEncoder (available in all runtimes: Node.js, Edge, browser)
 * so this file can be safely bundled for edge routes.
 */
const safeEqual = (a: string, b: string): boolean => {
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  if (bufA.length !== bufB.length) {
    // XOR against itself — keeps constant time, always returns false
    let r = 0;
    for (let i = 0; i < bufA.length; i++) r |= bufA[i] ^ bufA[i];
    return r === 1; // always false
  }
  let result = 0;
  for (let i = 0; i < bufA.length; i++) result |= bufA[i] ^ bufB[i];
  return result === 0;
};

const provider = {
  id: 'credentials',
  provider: Credentials({
    credentials: {
      password: { label: 'Password', type: 'password' },
      token: { label: 'Access Token', type: 'password' },
      username: { label: 'Username', type: 'text' },
    },
    async authorize(credentials) {
      const validUsername = process.env.AUTH_CREDENTIALS_USERNAME;
      const validPassword = process.env.AUTH_CREDENTIALS_PASSWORD;
      const validToken = process.env.AUTH_TOKEN;
      const userId = process.env.AUTH_USER_ID || 'credentials_user';

      // Username/password authentication
      if (credentials?.username && credentials?.password) {
        if (
          validUsername &&
          validPassword &&
          safeEqual(credentials.username as string, validUsername) &&
          safeEqual(credentials.password as string, validPassword)
        ) {
          return {
            id: userId,
            name: credentials.username as string,
          };
        }
        return null;
      }

      // Token-based authentication
      if (credentials?.token) {
        if (validToken && safeEqual(credentials.token as string, validToken)) {
          return {
            id: userId,
            name: 'Token User',
          };
        }
        return null;
      }

      return null;
    },
  }),
};

export default provider;
