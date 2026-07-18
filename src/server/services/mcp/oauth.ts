import { LobeChatDatabase } from '@lobechat/database';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';

import {
  mcpOAuthTokens,
  NewMcpOAuthTokenItem,
} from '@/database/schemas/mcpOAuth';
import { oauthHandoffs } from '@/database/schemas/oidc';
import { createMCPValidatingFetch, sanitizeMCPURLForLogging } from '@/libs/mcp/http';
import { describeToolsDebugError, logToolsDebugSafe } from '@/libs/logger/toolsDebug';
import { generateCodeChallenge, generateCodeVerifier, generateState } from '@/libs/mcp/pkce';
import {
  OAuthCallbackParams,
  OAuthInitiateParams,
  OAuthTokenSet,
  OAuthTokenStatus,
} from '@/libs/mcp/types';

/** Compute a safe `expiresAt` — falls back to 1-hour lifetime when
 *  the token response omits `expires_in`. */
const computeExpiresAt = (expiresIn?: number): number => {
  return Date.now() + (expiresIn ?? 3600) * 1000;
};

interface TokenEndpointResponse {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
}

type FetchBody = NonNullable<Parameters<typeof fetch>[1]>['body'];

export class McpOAuthService {
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase) {
    this.db = db;
  }

  /**
   * Initiate the OAuth 2.1 Authorization Code flow with PKCE.
   * Generates PKCE verifier + challenge, creates an OAuth state,
   * stores it in the oauthHandoffs table, and returns the authorization URL.
   */
  async initiateOAuth(
    userId: string,
    params: OAuthInitiateParams,
  ): Promise<{ authorizeUrl: string }> {
    const start = Date.now();
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = generateState();

    logToolsDebugSafe('oauth_operation_started', {
      authType: 'oauth2',
      credentialConfigured: !!params.clientSecret,
      endpoint: sanitizeMCPURLForLogging(params.authorizationEndpoint),
      operation: 'initiate',
      scopeCount: params.scope?.split(/\s+/).filter(Boolean).length || 0,
    });

    // Build the authorization URL
    const authorizeUrl = new URL(params.authorizationEndpoint);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', params.clientId);
    authorizeUrl.searchParams.set('redirect_uri', params.redirectUri);
    authorizeUrl.searchParams.set('code_challenge', codeChallenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');
    authorizeUrl.searchParams.set('state', state);
    if (params.scope) {
      authorizeUrl.searchParams.set('scope', params.scope);
    }

    // Store the transient OAuth state in oauthHandoffs
    await this.db.insert(oauthHandoffs).values({
      client: 'mcp-oauth',
      id: state,
      payload: {
        clientId: params.clientId,
        clientSecret: params.clientSecret,
        codeVerifier,
        pluginIdentifier: params.pluginIdentifier,
        redirectUri: params.redirectUri,
        tokenEndpoint: params.tokenEndpoint,
        tokenEndpointAuthMethodsSupported: params.tokenEndpointAuthMethodsSupported,
        userId,
      },
    });

    logToolsDebugSafe('oauth_operation_complete', {
      durationMs: Date.now() - start,
      operation: 'initiate',
      outcome: 'authorization_pending',
      statePresent: true,
    });

    return { authorizeUrl: authorizeUrl.toString() };
  }

  /**
   * Handle the OAuth callback after user authorization.
   * Validates the state, exchanges the authorization code for tokens,
   * stores the tokens, and cleans up the transient state.
   */
  async handleOAuthCallback(params: OAuthCallbackParams): Promise<{ pluginIdentifier: string }> {
    const start = Date.now();
    logToolsDebugSafe('oauth_operation_started', {
      callbackErrorPresent: !!params.error,
      codePresent: !!params.code,
      operation: 'callback',
      statePresent: !!params.state,
    });

    if (params.error) {
      logToolsDebugSafe('oauth_operation_failed', {
        durationMs: Date.now() - start,
        errorKind: 'authorization_callback_error',
        failurePhase: 'callback',
        operation: 'callback',
      });
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `OAuth authorization failed: ${params.error_description || params.error}`,
      });
    }

    // Look up the stored state
    const [storedState] = await this.db
      .select()
      .from(oauthHandoffs)
      .where(eq(oauthHandoffs.id, params.state));

    if (!storedState) {
      logToolsDebugSafe('oauth_operation_failed', {
        durationMs: Date.now() - start,
        errorKind: 'invalid_state',
        failurePhase: 'state_lookup',
        operation: 'callback',
      });
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Invalid OAuth state. The authorization session may have expired.',
      });
    }

    const payload = storedState.payload as Record<string, any>;
    const codeVerifier = payload.codeVerifier as string;
    const tokenEndpoint = payload.tokenEndpoint as string;
    const userId = payload.userId as string;
    const clientId = payload.clientId as string;
    const clientSecret = payload.clientSecret as string | undefined;
    const pluginIdentifier = payload.pluginIdentifier as string;
    const redirectUri = payload.redirectUri as string;
    const tokenEndpointAuthMethodsSupported = payload.tokenEndpointAuthMethodsSupported as string[] | undefined;

    if (!codeVerifier || !tokenEndpoint) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Stored OAuth state is incomplete.',
      });
    }

    // Exchange the authorization code for tokens
    const tokenResponse = await this.exchangeCodeForTokens(
      tokenEndpoint,
      params.code,
      codeVerifier,
      clientId,
      redirectUri,
      clientSecret,
      tokenEndpointAuthMethodsSupported,
    );

    // Calculate expiry (defaults to 1 hour if provider doesn't return expires_in)
    const expiresAt = computeExpiresAt(tokenResponse.expires_in);

    // Store the tokens
    await this.storeTokens(userId, {
      accessToken: tokenResponse.access_token,
      clientId,
      clientSecret,
      expiresAt,
      pluginIdentifier,
      refreshToken: tokenResponse.refresh_token,
      scope: tokenResponse.scope || payload.scope,
      tokenEndpoint,
      tokenEndpointAuthMethodsSupported,
      tokenType: tokenResponse.token_type || 'Bearer',
    });

    // Clean up the transient state
    await this.db.delete(oauthHandoffs).where(eq(oauthHandoffs.id, params.state));

    logToolsDebugSafe('oauth_operation_complete', {
      credentialConfigured: true,
      durationMs: Date.now() - start,
      operation: 'callback',
      outcome: 'stored',
    });

    return { pluginIdentifier };
  }

  /**
   * Get the OAuth token for a specific plugin.
   */
  async getOAuthToken(
    userId: string,
    pluginIdentifier: string,
  ): Promise<OAuthTokenSet | null> {
    const [record] = await this.db
      .select()
      .from(mcpOAuthTokens)
      .where(
        and(
          eq(mcpOAuthTokens.userId, userId),
          eq(mcpOAuthTokens.pluginIdentifier, pluginIdentifier),
        ),
      );

    if (!record) return null;

    return {
      accessToken: record.accessToken,
      expiresAt: record.expiresAt?.getTime(),
      refreshToken: record.refreshToken || undefined,
      scope: record.scope || undefined,
      tokenType: record.tokenType || undefined,
    };
  }

  /**
   * Check the status of an OAuth token for a plugin.
   */
  async getOAuthTokenStatus(
    userId: string,
    pluginIdentifier: string,
  ): Promise<OAuthTokenStatus> {
    const token = await this.getOAuthToken(userId, pluginIdentifier);

    if (!token) return 'missing';

    if (token.expiresAt && token.expiresAt < Date.now()) {
      // Token is expired but might be refreshable
      if (token.refreshToken) return 'expired_refreshable';
      return 'expired';
    }

    return 'valid';
  }

  /**
   * Refresh an OAuth token using the refresh token.
   */
  async refreshOAuthToken(
    userId: string,
    pluginIdentifier: string,
  ): Promise<OAuthTokenSet | null> {
    const start = Date.now();
    logToolsDebugSafe('oauth_operation_started', {
      operation: 'refresh',
      reason: 'refresh_requested',
    });

    const [record] = await this.db
      .select()
      .from(mcpOAuthTokens)
      .where(
        and(
          eq(mcpOAuthTokens.userId, userId),
          eq(mcpOAuthTokens.pluginIdentifier, pluginIdentifier),
        ),
      );

    if (!record || !record.refreshToken) {
      logToolsDebugSafe('oauth_operation_complete', {
        credentialPresent: false,
        durationMs: Date.now() - start,
        operation: 'refresh',
        outcome: 'missing_refresh_credential',
      });
      return null;
    }

    const metadata = record.serverMetadata as Record<string, any> | null;
    const tokenEndpoint = metadata?.token_endpoint;
    const clientId = record.clientId;
    const clientSecret = metadata?.client_secret as string | undefined;
    const authMethodsSupported = metadata?.token_endpoint_auth_methods_supported as string[] | undefined;

    if (!tokenEndpoint) {
      logToolsDebugSafe('oauth_operation_failed', {
        durationMs: Date.now() - start,
        errorKind: 'missing_token_endpoint',
        failurePhase: 'metadata_lookup',
        operation: 'refresh',
      });
      return null;
    }

    try {
      const validatingFetch = createMCPValidatingFetch();
      let headers: Record<string, string>;
      let body: FetchBody;

      const supportsBasic = !authMethodsSupported ||
        authMethodsSupported.includes('client_secret_basic');
      const supportsPost = !authMethodsSupported ||
        authMethodsSupported.includes('client_secret_post');
      const useBasic = clientSecret !== undefined && supportsBasic;
      const usePostSecret = clientSecret !== undefined && !supportsBasic && supportsPost;

      if (useBasic) {
        // Confidential client with Basic Auth (Notion)
        headers = {
          'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        };
        body = new URLSearchParams({
          client_id: clientId,
          grant_type: 'refresh_token',
          refresh_token: record.refreshToken,
        });
      } else if (usePostSecret) {
        // Confidential client with client_secret in body (Context7)
        headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
        body = new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret!,
          grant_type: 'refresh_token',
          refresh_token: record.refreshToken,
        });
      } else {
        // Public client — form-encoded body
        headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
        body = new URLSearchParams({
          client_id: clientId,
          grant_type: 'refresh_token',
          refresh_token: record.refreshToken,
        });
      }

      const response = await validatingFetch(tokenEndpoint, {
        body,
        headers,
        method: 'POST',
      });

      let data: TokenEndpointResponse;

      if (!response.ok) {
        // If Basic Auth failed (400/401), fall back to client_secret_post.
        // FastMCP servers (Tavily) advertise client_secret_basic but fail to
        // parse the Authorization header (fastmcp#214).
        if (useBasic && (response.status === 400 || response.status === 401)) {
          logToolsDebugSafe('oauth_operation_retry', {
            authType: 'client_secret_post',
            httpStatus: response.status,
            operation: 'refresh',
            reason: 'client_secret_basic_rejected',
          });

          const fallbackHeaders = { 'Content-Type': 'application/x-www-form-urlencoded' };
          const fallbackBody = new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret!,
            grant_type: 'refresh_token',
            refresh_token: record.refreshToken,
          });

          const fallbackResponse = await validatingFetch(tokenEndpoint, {
            body: fallbackBody,
            headers: fallbackHeaders,
            method: 'POST',
          });

          if (!fallbackResponse.ok) {
            logToolsDebugSafe('oauth_operation_failed', {
              durationMs: Date.now() - start,
              failurePhase: 'fallback_refresh',
              httpStatus: fallbackResponse.status,
              operation: 'refresh',
            });
            throw new Error(`Token refresh failed: HTTP ${fallbackResponse.status}`);
          }

          data = (await fallbackResponse.json()) as TokenEndpointResponse;
        } else {
          throw new Error(`Token refresh failed: HTTP ${response.status}`);
        }
      } else {
        data = (await response.json()) as TokenEndpointResponse;
      }

      const expiresAt = computeExpiresAt(data.expires_in);

      // Update the stored token
      await this.db
        .update(mcpOAuthTokens)
        .set({
          accessToken: data.access_token,
          expiresAt: new Date(expiresAt),
          refreshToken: data.refresh_token || record.refreshToken,
          scope: data.scope || record.scope || undefined,
          tokenType: data.token_type || record.tokenType || 'Bearer',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(mcpOAuthTokens.userId, userId),
            eq(mcpOAuthTokens.pluginIdentifier, pluginIdentifier),
          ),
        );

      logToolsDebugSafe('oauth_operation_complete', {
        credentialPresent: true,
        durationMs: Date.now() - start,
        operation: 'refresh',
        outcome: 'refreshed',
        scopeCount: data.scope?.split(/\s+/).filter(Boolean).length || 0,
      });

      return {
        accessToken: data.access_token,
        expiresAt,
        refreshToken: data.refresh_token || record.refreshToken,
        scope: data.scope || record.scope || undefined,
        tokenType: data.token_type || record.tokenType || 'Bearer',
      };
    } catch (error) {
      logToolsDebugSafe('oauth_operation_failed', {
        ...describeToolsDebugError(error),
        durationMs: Date.now() - start,
        failurePhase: 'token_request',
        operation: 'refresh',
      });
      return null;
    }
  }

  /**
   * Revoke/delete stored OAuth tokens for a plugin.
   */
  async revokeOAuthToken(userId: string, pluginIdentifier: string): Promise<void> {
    const start = Date.now();
    logToolsDebugSafe('oauth_operation_started', { operation: 'revoke' });
    await this.db
      .delete(mcpOAuthTokens)
      .where(
        and(
          eq(mcpOAuthTokens.userId, userId),
          eq(mcpOAuthTokens.pluginIdentifier, pluginIdentifier),
        ),
      );

    logToolsDebugSafe('oauth_operation_complete', {
      durationMs: Date.now() - start,
      operation: 'revoke',
      outcome: 'deleted',
    });
  }

  /**
   * Exchange an authorization code for tokens.
   *
   * Supports three auth modes with automatic fallback:
   * - client_secret_basic: HTTP Basic Auth (Notion) — used when advertised or default
   * - client_secret_post: client_id + client_secret in body (Context7) — used when basic is not supported
   * - Public client (no clientSecret): client_id in body, standard PKCE
   *
   * When the server advertises client_secret_basic but the token endpoint has a
   * buggy parser (known issue with fastmcp/Tavily), the exchange automatically
   * falls back to client_secret_post.
   */
  private async exchangeCodeForTokens(
    tokenEndpoint: string,
    code: string,
    codeVerifier: string,
    clientId: string,
    redirectUri: string,
    clientSecret?: string,
    tokenEndpointAuthMethodsSupported?: string[],
  ): Promise<TokenEndpointResponse> {
    const start = Date.now();
    logToolsDebugSafe('oauth_operation_started', {
      authMethodCount: tokenEndpointAuthMethodsSupported?.length || 0,
      credentialConfigured: !!clientSecret,
      endpoint: sanitizeMCPURLForLogging(tokenEndpoint),
      operation: 'token_exchange',
    });
    const validatingFetch = createMCPValidatingFetch();

    const supportsBasic = !tokenEndpointAuthMethodsSupported ||
      tokenEndpointAuthMethodsSupported.includes('client_secret_basic');
    const supportsPost = !tokenEndpointAuthMethodsSupported ||
      tokenEndpointAuthMethodsSupported.includes('client_secret_post');
    const useBasic = clientSecret !== undefined && supportsBasic;
    const usePostSecret = clientSecret !== undefined && !supportsBasic && supportsPost;

    let headers: Record<string, string>;
    let body: FetchBody;

    if (useBasic) {
      headers = {
        'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      };
      body = new URLSearchParams({
        client_id: clientId,
        code,
        code_verifier: codeVerifier,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      });
    } else if (usePostSecret) {
      headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
      body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret!,
        code,
        code_verifier: codeVerifier,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      });
    } else {
      // Public client (standard PKCE)
      headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
      body = new URLSearchParams({
        client_id: clientId,
        code,
        code_verifier: codeVerifier,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      });
    }

    const primaryResponse = await validatingFetch(tokenEndpoint, {
      body,
      headers,
      method: 'POST',
    });

    // If the primary attempt fails (400/401) and we used Basic Auth, fall back
    // to client_secret_post.  FastMCP servers (Tavily) advertise client_secret_basic
    // but fail to parse the Authorization header (fastmcp#214).
    if (!primaryResponse.ok) {
      if (useBasic && (primaryResponse.status === 400 || primaryResponse.status === 401)) {
        logToolsDebugSafe('oauth_operation_retry', {
          authType: 'client_secret_post',
          httpStatus: primaryResponse.status,
          operation: 'token_exchange',
          reason: 'client_secret_basic_rejected',
        });

        const fallbackHeaders = { 'Content-Type': 'application/x-www-form-urlencoded' };
        const fallbackBody = new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret!,
          code,
          code_verifier: codeVerifier,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
        });

        const fallbackResponse = await validatingFetch(tokenEndpoint, {
          body: fallbackBody,
          headers: fallbackHeaders,
          method: 'POST',
        });

        if (!fallbackResponse.ok) {
          logToolsDebugSafe('oauth_operation_failed', {
            durationMs: Date.now() - start,
            failurePhase: 'fallback_exchange',
            httpStatus: fallbackResponse.status,
            operation: 'token_exchange',
          });
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: `Failed to exchange authorization code: HTTP ${fallbackResponse.status}.`,
          });
        }

        const data = (await fallbackResponse.json()) as TokenEndpointResponse;
        if (!data.access_token) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Token exchange response did not include an access_token.',
          });
        }
        logToolsDebugSafe('oauth_operation_complete', {
          credentialPresent: true,
          durationMs: Date.now() - start,
          operation: 'token_exchange',
          outcome: 'fallback_succeeded',
        });
        return data;
      }

      logToolsDebugSafe('oauth_operation_failed', {
        durationMs: Date.now() - start,
        failurePhase: 'primary_exchange',
        httpStatus: primaryResponse.status,
        operation: 'token_exchange',
      });
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to exchange authorization code: HTTP ${primaryResponse.status}.`,
      });
    }

    const data = (await primaryResponse.json()) as TokenEndpointResponse;

    if (!data.access_token) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Token exchange response did not include an access_token.',
      });
    }

    logToolsDebugSafe('oauth_operation_complete', {
      credentialPresent: true,
      durationMs: Date.now() - start,
      operation: 'token_exchange',
      outcome: 'succeeded',
    });

    return data;
  }

  /**
   * Store OAuth tokens in the database.
   */
  private async storeTokens(
    userId: string,
    token: {
      accessToken: string;
      clientId: string;
      clientSecret?: string;
      expiresAt?: number;
      pluginIdentifier: string;
      refreshToken?: string;
      scope?: string;
      tokenEndpoint?: string;
      tokenEndpointAuthMethodsSupported?: string[];
      tokenType?: string;
    },
  ): Promise<void> {
    // Upsert: remove existing token for this plugin/user, then insert new one
    await this.db
      .delete(mcpOAuthTokens)
      .where(
        and(
          eq(mcpOAuthTokens.userId, userId),
          eq(mcpOAuthTokens.pluginIdentifier, token.pluginIdentifier),
        ),
      );

    const serverMetadata: Record<string, any> = {};
    if (token.tokenEndpoint) {
      serverMetadata.token_endpoint = token.tokenEndpoint;
    }
    if (token.clientSecret) {
      serverMetadata.client_secret = token.clientSecret;
    }
    if (token.tokenEndpointAuthMethodsSupported) {
      serverMetadata.token_endpoint_auth_methods_supported = token.tokenEndpointAuthMethodsSupported;
    }

    const insert: NewMcpOAuthTokenItem = {
      accessToken: token.accessToken,
      clientId: token.clientId,
      expiresAt: token.expiresAt ? new Date(token.expiresAt) : new Date(computeExpiresAt()),
      pluginIdentifier: token.pluginIdentifier,
      refreshToken: token.refreshToken || null,
      scope: token.scope || null,
      serverMetadata: Object.keys(serverMetadata).length > 0 ? serverMetadata : null,
      tokenType: token.tokenType || 'Bearer',
      userId,
    };

    await this.db.insert(mcpOAuthTokens).values(insert);

    logToolsDebugSafe('oauth_operation_complete', {
      credentialPresent: true,
      operation: 'token_store',
      outcome: 'stored',
      scopeCount: token.scope?.split(/\s+/).filter(Boolean).length || 0,
    });
  }
}
