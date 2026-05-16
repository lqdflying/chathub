import { LobeChatDatabase } from '@lobechat/database';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import debug from 'debug';

import {
  mcpOAuthTokens,
  NewMcpOAuthTokenItem,
} from '@/database/schemas/mcpOAuth';
import { oauthHandoffs } from '@/database/schemas/oidc';
import { generateCodeChallenge, generateCodeVerifier, generateState } from '@/libs/mcp/pkce';
import {
  OAuthCallbackParams,
  OAuthInitiateParams,
  OAuthTokenSet,
  OAuthTokenStatus,
} from '@/libs/mcp/types';

const log = debug('lobe-mcp:oauth-service');

/** Default token lifetime when the provider does not return `expires_in`
 *  (Notion MCP).  Notion access tokens expire after 1 hour. */
const DEFAULT_TOKEN_LIFETIME_MS = 60 * 60 * 1000; // 1 hour

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
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = generateState();

    log('Initiating OAuth for plugin %s, client %s', params.pluginIdentifier, params.clientId);

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
      id: state,
      client: 'mcp-oauth',
      payload: {
        codeVerifier,
        clientId: params.clientId,
        clientSecret: params.clientSecret,
        pluginIdentifier: params.pluginIdentifier,
        redirectUri: params.redirectUri,
        tokenEndpoint: params.tokenEndpoint,
        tokenEndpointAuthMethodsSupported: params.tokenEndpointAuthMethodsSupported,
        userId,
      },
    });

    log('OAuth state stored, state=%s', state);

    return { authorizeUrl: authorizeUrl.toString() };
  }

  /**
   * Handle the OAuth callback after user authorization.
   * Validates the state, exchanges the authorization code for tokens,
   * stores the tokens, and cleans up the transient state.
   */
  async handleOAuthCallback(params: OAuthCallbackParams): Promise<{ pluginIdentifier: string }> {
    log('Handling OAuth callback, state=%s', params.state);

    if (params.error) {
      log('OAuth callback returned error: %s - %s', params.error, params.error_description);
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
      log('No stored state found for state=%s', params.state);
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

    log('OAuth callback handled successfully for plugin %s', pluginIdentifier);

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
    log('Refreshing OAuth token for plugin %s', pluginIdentifier);

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
      log('No refresh token available for plugin %s', pluginIdentifier);
      return null;
    }

    const metadata = record.serverMetadata as Record<string, any> | null;
    const tokenEndpoint = metadata?.token_endpoint;
    const clientId = record.clientId;
    const clientSecret = metadata?.client_secret as string | undefined;
    const authMethodsSupported = metadata?.token_endpoint_auth_methods_supported as string[] | undefined;

    if (!tokenEndpoint) {
      log('No token endpoint in server metadata for plugin %s', pluginIdentifier);
      return null;
    }

    try {
      let headers: Record<string, string>;
      let body: BodyInit;

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

      const response = await fetch(tokenEndpoint, {
        method: 'POST',
        headers,
        body,
      });

      let data: TokenEndpointResponse;

      if (!response.ok) {
        // If Basic Auth failed (400/401), fall back to client_secret_post.
        // FastMCP servers (Tavily) advertise client_secret_basic but fail to
        // parse the Authorization header (fastmcp#214).
        if (useBasic && (response.status === 400 || response.status === 401)) {
          log('Basic Auth refresh failed (%d), falling back to client_secret_post',
            response.status);

          const fallbackHeaders = { 'Content-Type': 'application/x-www-form-urlencoded' };
          const fallbackBody = new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret!,
            grant_type: 'refresh_token',
            refresh_token: record.refreshToken,
          });

          const fallbackResponse = await fetch(tokenEndpoint, {
            method: 'POST',
            headers: fallbackHeaders,
            body: fallbackBody,
          });

          if (!fallbackResponse.ok) {
            log('Fallback token refresh also failed with status %d', fallbackResponse.status);
            throw new Error(`Token refresh failed: ${fallbackResponse.statusText}`);
          }

          log('Fallback token refresh succeeded via client_secret_post');
          data = (await fallbackResponse.json()) as TokenEndpointResponse;
        } else {
          log('Token refresh failed with status %d', response.status);
          throw new Error(`Token refresh failed: ${response.statusText}`);
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

      log('Token refreshed successfully for plugin %s', pluginIdentifier);

      return {
        accessToken: data.access_token,
        expiresAt,
        refreshToken: data.refresh_token || record.refreshToken,
        scope: data.scope || record.scope || undefined,
        tokenType: data.token_type || record.tokenType || 'Bearer',
      };
    } catch (error) {
      log('Token refresh error: %O', error);
      return null;
    }
  }

  /**
   * Revoke/delete stored OAuth tokens for a plugin.
   */
  async revokeOAuthToken(userId: string, pluginIdentifier: string): Promise<void> {
    await this.db
      .delete(mcpOAuthTokens)
      .where(
        and(
          eq(mcpOAuthTokens.userId, userId),
          eq(mcpOAuthTokens.pluginIdentifier, pluginIdentifier),
        ),
      );

    log('OAuth token revoked for plugin %s', pluginIdentifier);
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
    log('Exchanging code for tokens at %s (hasClientSecret=%s, supportedMethods=%O)',
      tokenEndpoint, !!clientSecret, tokenEndpointAuthMethodsSupported);

    const supportsBasic = !tokenEndpointAuthMethodsSupported ||
      tokenEndpointAuthMethodsSupported.includes('client_secret_basic');
    const supportsPost = !tokenEndpointAuthMethodsSupported ||
      tokenEndpointAuthMethodsSupported.includes('client_secret_post');
    const useBasic = clientSecret !== undefined && supportsBasic;
    const usePostSecret = clientSecret !== undefined && !supportsBasic && supportsPost;

    let headers: Record<string, string>;
    let body: BodyInit;

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

    const primaryResponse = await fetch(tokenEndpoint, {
      method: 'POST',
      headers,
      body,
    });

    // If the primary attempt fails (400/401) and we used Basic Auth, fall back
    // to client_secret_post.  FastMCP servers (Tavily) advertise client_secret_basic
    // but fail to parse the Authorization header (fastmcp#214).
    if (!primaryResponse.ok) {
      const errorText = await primaryResponse.text();
      if (useBasic && (primaryResponse.status === 400 || primaryResponse.status === 401)) {
        log('Basic Auth failed (%d), falling back to client_secret_post: %s',
          primaryResponse.status, errorText);

        const fallbackHeaders = { 'Content-Type': 'application/x-www-form-urlencoded' };
        const fallbackBody = new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret!,
          code,
          code_verifier: codeVerifier,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
        });

        const fallbackResponse = await fetch(tokenEndpoint, {
          method: 'POST',
          headers: fallbackHeaders,
          body: fallbackBody,
        });

        if (!fallbackResponse.ok) {
          const fallbackError = await fallbackResponse.text();
          log('Fallback token exchange also failed with status %d: %s',
            fallbackResponse.status, fallbackError);
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: `Failed to exchange authorization code: ${fallbackResponse.status} ${fallbackError}`,
          });
        }

        log('Fallback token exchange succeeded via client_secret_post');
        const data = (await fallbackResponse.json()) as TokenEndpointResponse;
        if (!data.access_token) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Token exchange response did not include an access_token.',
          });
        }
        return data;
      }

      log('Token exchange failed with status %d: %s', primaryResponse.status, errorText);
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to exchange authorization code: ${primaryResponse.status} ${errorText}`,
      });
    }

    const data = (await primaryResponse.json()) as TokenEndpointResponse;

    if (!data.access_token) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Token exchange response did not include an access_token.',
      });
    }

    log('Token exchange successful');

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
      userId,
      pluginIdentifier: token.pluginIdentifier,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken || null,
      tokenType: token.tokenType || 'Bearer',
      expiresAt: token.expiresAt ? new Date(token.expiresAt) : new Date(computeExpiresAt()),
      scope: token.scope || null,
      clientId: token.clientId,
      serverMetadata: Object.keys(serverMetadata).length > 0 ? serverMetadata : null,
    };

    await this.db.insert(mcpOAuthTokens).values(insert);

    log('OAuth tokens stored for plugin %s', token.pluginIdentifier);
  }
}
