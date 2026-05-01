import {
  AuthorizationServerMetadata,
  OAuthClientInformationFull,
  OAuthProtectedResourceMetadata,
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
  registerClient,
} from '@modelcontextprotocol/sdk/client/auth.js';
import debug from 'debug';

const log = debug('lobe-mcp:oauth-discovery');

export interface DiscoveredOAuthMetadata {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  scopesSupported?: string[];
  tokenEndpointAuthMethodsSupported?: string[];
  clientId?: string;
  clientSecret?: string;
  clientIdIssuedAt?: number;
  clientSecretExpiresAt?: number;
}

/**
 * Auto-discover OAuth metadata from an MCP server URL.
 *
 * Uses the MCP SDK's well-known endpoint discovery:
 * 1. GET /.well-known/oauth-protected-resource → authorization server URL + scopes
 * 2. GET /.well-known/oauth-authorization-server → endpoints + capabilities
 * 3. Optional: POST registration_endpoint → dynamic client registration
 *
 * @param serverUrl - The MCP server's HTTP URL (e.g. https://mcp.example.com)
 * @param clientName - Human-readable name for dynamic client registration
 * @param redirectUri - OAuth redirect URI for this client
 * @param fetchFn - Optional fetch function override (for server-side use)
 */
export async function discoverOAuthMetadata(
  serverUrl: string,
  clientName?: string,
  redirectUri?: string,
  fetchFn?: typeof fetch,
): Promise<DiscoveredOAuthMetadata> {
  log('Discovering OAuth metadata for %s', serverUrl);

  // Step 1: Discover protected resource metadata
  let resourceMetadata: OAuthProtectedResourceMetadata | undefined;
  let authorizationServerUrl: string = serverUrl;

  try {
    resourceMetadata = await discoverOAuthProtectedResourceMetadata(serverUrl, {}, fetchFn);
    if (
      resourceMetadata?.authorization_servers &&
      resourceMetadata.authorization_servers.length > 0
    ) {
      authorizationServerUrl = resourceMetadata.authorization_servers[0].toString();
      log('Found authorization server URL: %s', authorizationServerUrl);
    }
  } catch (err) {
    log('Protected resource metadata discovery failed: %O', err);
    // Fall back to using the server URL as the auth server
  }

  // Step 2: Discover authorization server metadata
  let authMetadata: AuthorizationServerMetadata | undefined;

  try {
    authMetadata = await discoverAuthorizationServerMetadata(authorizationServerUrl, { fetchFn });
    log('Authorization server metadata discovered: %O', authMetadata);
  } catch (err) {
    log('Authorization server metadata discovery failed: %O', err);
    throw new Error(
      `OAuth metadata discovery failed for ${serverUrl}. The server may not support OAuth 2.1 auto-discovery.`,
    );
  }

  if (!authMetadata) {
    throw new Error(
      `No authorization server metadata found for ${serverUrl}. The server may not support OAuth 2.1.`,
    );
  }

  // Step 3: Optional — dynamic client registration
  let clientId: string | undefined;
  let clientSecret: string | undefined;
  let clientIdIssuedAt: number | undefined;
  let clientSecretExpiresAt: number | undefined;

  if (
    redirectUri &&
    'registration_endpoint' in authMetadata &&
    authMetadata.registration_endpoint
  ) {
    try {
      const registration = await registerClient(
        authorizationServerUrl,
        {
          metadata: authMetadata,
          clientMetadata: {
            client_name: clientName || 'LobeChat MCP Client',
            redirect_uris: [new URL(redirectUri)],
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
          },
        },
        fetchFn,
      );

      clientId = registration.client_id;
      clientSecret = registration.client_secret;
      clientIdIssuedAt = registration.client_id_issued_at
        ? registration.client_id_issued_at * 1000
        : undefined;
      clientSecretExpiresAt = registration.client_secret_expires_at
        ? registration.client_secret_expires_at * 1000
        : undefined;

      log('Dynamic client registration successful, client_id: %s', clientId);
    } catch (err) {
      log('Dynamic client registration failed: %O', err);
      // Continue without registration — user will need to provide client ID manually
    }
  }

  return {
    authorizationEndpoint: authMetadata.authorization_endpoint.toString(),
    tokenEndpoint: authMetadata.token_endpoint.toString(),
    registrationEndpoint: 'registration_endpoint' in authMetadata
      ? authMetadata.registration_endpoint?.toString()
      : undefined,
    scopesSupported: resourceMetadata?.scopes_supported || authMetadata.scopes_supported,
    tokenEndpointAuthMethodsSupported: authMetadata.token_endpoint_auth_methods_supported,
    clientId,
    clientSecret,
    clientIdIssuedAt,
    clientSecretExpiresAt,
  };
}
