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
    );

    // Calculate expiry
    const expiresAt = tokenResponse.expires_in
      ? Date.now() + tokenResponse.expires_in * 1000
      : undefined;

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
      if (token.refreshToken) return 'expired';
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

    if (!tokenEndpoint) {
      log('No token endpoint in server metadata for plugin %s', pluginIdentifier);
      return null;
    }

    try {
      let headers: Record<string, string>;
      let body: BodyInit;

      if (clientSecret) {
        // Confidential client (e.g. Notion) — JSON body + HTTP Basic Auth
        headers = {
          'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
          'Content-Type': 'application/json',
        };
        body = JSON.stringify({
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

      if (!response.ok) {
        log('Token refresh failed with status %d', response.status);
        throw new Error(`Token refresh failed: ${response.statusText}`);
      }

      const data = (await response.json()) as TokenEndpointResponse;

      const expiresAt = data.expires_in
        ? Date.now() + data.expires_in * 1000
        : undefined;

      // Update the stored token
      await this.db
        .update(mcpOAuthTokens)
        .set({
          accessToken: data.access_token,
          expiresAt: expiresAt ? new Date(expiresAt) : undefined,
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
   * Supports two auth modes:
   * - Confidential client (clientSecret present, e.g. Notion MCP):
   *   HTTP Basic Auth + Content-Type: application/json
   * - Public client (no clientSecret, standard PKCE):
   *   Content-Type: application/x-www-form-urlencoded with client_id in body
   */
  private async exchangeCodeForTokens(
    tokenEndpoint: string,
    code: string,
    codeVerifier: string,
    clientId: string,
    redirectUri: string,
    clientSecret?: string,
  ): Promise<TokenEndpointResponse> {
    log('Exchanging code for tokens at %s (hasClientSecret=%s)', tokenEndpoint, !!clientSecret);

    let headers: Record<string, string>;
    let body: BodyInit;

    if (clientSecret) {
      // Confidential client (e.g. Notion) — JSON body + HTTP Basic Auth
      headers = {
        'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/json',
      };
      body = JSON.stringify({
        code,
        code_verifier: codeVerifier,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      });
    } else {
      // Public client (standard PKCE) — form-encoded body with client_id
      headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
      body = new URLSearchParams({
        client_id: clientId,
        code,
        code_verifier: codeVerifier,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      });
    }

    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers,
      body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      log('Token exchange failed with status %d: %s', response.status, errorText);
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `Failed to exchange authorization code: ${response.status} ${errorText}`,
      });
    }

    const data = (await response.json()) as TokenEndpointResponse;

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

    const insert: NewMcpOAuthTokenItem = {
      userId,
      pluginIdentifier: token.pluginIdentifier,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken || null,
      tokenType: token.tokenType || 'Bearer',
      expiresAt: token.expiresAt ? new Date(token.expiresAt) : undefined,
      scope: token.scope || null,
      clientId: token.clientId,
      serverMetadata: Object.keys(serverMetadata).length > 0 ? serverMetadata : null,
    };

    await this.db.insert(mcpOAuthTokens).values(insert);

    log('OAuth tokens stored for plugin %s', token.pluginIdentifier);
  }
}
