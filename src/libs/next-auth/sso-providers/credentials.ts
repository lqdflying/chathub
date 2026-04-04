import Credentials from 'next-auth/providers/credentials';

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
          credentials.username === validUsername &&
          credentials.password === validPassword
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
        if (validToken && credentials.token === validToken) {
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
