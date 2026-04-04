# Credentials Login Flow

This document describes the current LobeHub browser login flow when `NEXT_AUTH_SSO_PROVIDERS=credentials` is enabled.

## Overview

LobeHub uses a single NextAuth Credentials provider for both browser login tabs:

- Password tab: submits `username` + `password`
- Access Token tab: submits `token`
- Both successful paths authenticate as the same logical user id: `AUTH_USER_ID` if set, otherwise `credentials_user`
- Password mode returns the submitted username as the session display name
- Token mode returns the fixed session display name `Token User`

The login UI currently shows both tabs whenever the credentials provider is enabled. Whether a tab actually succeeds depends on whether its backing environment variables are configured.

There are two common browser entry paths into the credentials sign-in page:

- The user tries to open a protected route, and middleware redirects to `/next-auth/signin?callbackUrl=...`
- The user clicks the app's login button, and the client navigates directly to `/next-auth/signin?callbackUrl=...` on the current host

## Validation Rules

- Password login succeeds only if `AUTH_CREDENTIALS_USERNAME` and `AUTH_CREDENTIALS_PASSWORD` are both configured and exactly match the submitted values.
- Token login succeeds only if `AUTH_TOKEN` is configured and matches the submitted value.
- Comparisons are performed with constant-time string checks.
- The password and token are used only for validation. They are not stored in the `users` table by this flow.

## Post-Login Behavior

- Credentials auth uses JWT session strategy.
- NextAuth stores the authenticated user id in the JWT session.
- Backend tRPC context reads `session.user.id` and treats the request as authenticated.
- On the first authenticated `user.getUserState` call, if no `users` row exists yet, LobeHub auto-creates one and retries.
- The current fallback auto-create path inserts only `users.id = AUTH_USER_ID || credentials_user`.
- In the current implementation, credentials login does not automatically persist `users.username`, `users.email`, the submitted password, or the submitted token.
- The client then redirects to the saved `callbackUrl`.
- If NextAuth returns a local absolute URL such as `http://0.0.0.0:33210/chat`, the client normalizes it to an in-app path like `/chat` before navigation.
- If NextAuth returns a malformed or external absolute URL, the client falls back to `/`.

## Flow Diagram

```mermaid
flowchart TD
  A{How does user reach sign-in?} -->|Protected route| B[Middleware redirects to /next-auth/signin with relative callbackUrl]
  A -->|Click login button| C[Client navigates to /next-auth/signin with current relative callbackUrl]
  B --> D[User chooses Password or Access Token tab]
  C --> D

  D --> E{Which login mode?}
  E -->|Password| F[Client calls signIn credentials with username password redirect false redirectTo callbackUrl]
  E -->|Token| G[Client calls signIn credentials with token redirect false redirectTo callbackUrl]

  F --> H[Credentials provider authorize]
  G --> H

  H --> I{Credential matches env config?}
  I -->|No| J[Return null and show inline login error]
  I -->|Yes password| K[Return user object id AUTH_USER_ID or credentials_user name submitted username]
  I -->|Yes token| L[Return user object id AUTH_USER_ID or credentials_user name Token User]

  K --> M[NextAuth writes userId into JWT and session.user.id]
  L --> M
  M --> N[Client receives result.url]
  N --> O[Normalize redirect URL]

  O --> P[tRPC context reads session.user.id]
  P --> Q[user.getUserState]
  Q --> R{User row exists?}
  R -->|No| S[Auto-create users row with current userId only]
  S --> Q
  R -->|Yes| T[Return initialized user state]

  O --> U{Redirect URL safe?}
  U -->|Local or same-origin| V[router.push normalized app path]
  U -->|Malformed or external| W[router.push fallback slash]

  T --> V
```

## Practical Notes

- If you configure only `AUTH_CREDENTIALS_USERNAME` and `AUTH_CREDENTIALS_PASSWORD`, only the Password tab will succeed.
- If you configure only `AUTH_TOKEN`, only the Access Token tab will succeed.
- If you configure both, either tab signs in as the same underlying `AUTH_USER_ID`.
- Credentials login is session-based for the browser, but `AUTH_TOKEN` can also be reused as a Bearer token for API access.
- `AUTH_USER_ID` becomes the persisted DB identity if the user row is auto-created.
- In the current fallback implementation, the `users` row may exist with only `id` populated and `username` left empty.