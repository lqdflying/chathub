import {
  AuthorizationServerMetadata,
  OAuthProtectedResourceMetadata,
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
  registerClient,
} from '@modelcontextprotocol/sdk/client/auth.js';
import debug from 'debug';

import { createMCPValidatingFetch, sanitizeMCPURLForLogging } from '@/libs/mcp/http';
import {
  describeToolsDebugError,
  logToolsDebugSafe,
} from '@/libs/logger/toolsDebug';

const log = debug('lobe-mcp:oauth-discovery');

export interface DiscoveredOAuthMetadata {
  authorizationEndpoint: string;
  clientId?: string;
  clientIdIssuedAt?: number;
  clientSecret?: string;
  clientSecretExpiresAt?: number;
  registrationEndpoint?: string;
  scopesSupported?: string[];
  tokenEndpoint: string;
  tokenEndpointAuthMethodsSupported?: string[];
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
  const start = Date.now();
  const sanitizedServerUrl = sanitizeMCPURLForLogging(serverUrl);
  log('Discovering OAuth metadata for %s', sanitizedServerUrl);
  logToolsDebugSafe('oauth_operation_started', {
    endpoint: sanitizedServerUrl,
    operation: 'discovery',
    registrationRequested: !!redirectUri,
  });
  const validatingFetch = createMCPValidatingFetch(fetchFn);

  // Step 1: Discover protected resource metadata
  let resourceMetadata: OAuthProtectedResourceMetadata | undefined;
  let authorizationServerUrl: string = serverUrl;

  try {
    resourceMetadata = await discoverOAuthProtectedResourceMetadata(serverUrl, {}, validatingFetch);
    if (
      resourceMetadata?.authorization_servers &&
      resourceMetadata.authorization_servers.length > 0
    ) {
      authorizationServerUrl = resourceMetadata.authorization_servers[0].toString();
      log('Found authorization server URL: %s', sanitizeMCPURLForLogging(authorizationServerUrl));
    }
  } catch (err) {
    logToolsDebugSafe('oauth_operation_failed', {
      ...describeToolsDebugError(err),
      failurePhase: 'protected_resource_discovery',
      operation: 'discovery',
      willRetry: true,
    });
    // Fall back to using the server URL as the auth server
  }

  // Step 2: Discover authorization server metadata
  let authMetadata: AuthorizationServerMetadata | undefined;

  try {
    authMetadata = await discoverAuthorizationServerMetadata(authorizationServerUrl, {
      fetchFn: validatingFetch,
    });
    logToolsDebugSafe('oauth_operation_complete', {
      authMethodCount: authMetadata?.token_endpoint_auth_methods_supported?.length || 0,
      durationMs: Date.now() - start,
      operation: 'authorization_server_discovery',
      registrationAvailable: !!authMetadata?.registration_endpoint,
      scopeCount: authMetadata?.scopes_supported?.length || 0,
    });
  } catch (err) {
    logToolsDebugSafe('oauth_operation_failed', {
      ...describeToolsDebugError(err),
      durationMs: Date.now() - start,
      failurePhase: 'authorization_server_discovery',
      operation: 'discovery',
    });
    throw new Error(
      `OAuth metadata discovery failed for ${sanitizedServerUrl}. The server may not support OAuth 2.1 auto-discovery.`,
    );
  }

  if (!authMetadata) {
    throw new Error(
      `No authorization server metadata found for ${sanitizedServerUrl}. The server may not support OAuth 2.1.`,
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
          clientMetadata: {
            client_name: clientName || 'LobeChat MCP Client',
            grant_types: ['authorization_code', 'refresh_token'],
            redirect_uris: [new URL(redirectUri)],
            response_types: ['code'],
          },
          fetchFn: validatingFetch,
          metadata: authMetadata,
        },
      );

      clientId = registration.client_id;
      clientSecret = registration.client_secret;
      clientIdIssuedAt = registration.client_id_issued_at
        ? registration.client_id_issued_at * 1000
        : undefined;
      clientSecretExpiresAt = registration.client_secret_expires_at
        ? registration.client_secret_expires_at * 1000
        : undefined;

      logToolsDebugSafe('oauth_operation_complete', {
        credentialConfigured: !!clientSecret,
        durationMs: Date.now() - start,
        operation: 'dynamic_client_registration',
        outcome: 'registered',
      });
    } catch (err) {
      logToolsDebugSafe('oauth_operation_failed', {
        ...describeToolsDebugError(err),
        failurePhase: 'dynamic_client_registration',
        operation: 'dynamic_client_registration',
      });
      // Continue without registration — user will need to provide client ID manually
    }
  }

  const result = {
    authorizationEndpoint: authMetadata.authorization_endpoint.toString(),
    clientId,
    clientIdIssuedAt,
    clientSecret,
    clientSecretExpiresAt,
    registrationEndpoint: 'registration_endpoint' in authMetadata
      ? authMetadata.registration_endpoint?.toString()
      : undefined,
    scopesSupported: resourceMetadata?.scopes_supported || authMetadata.scopes_supported,
    tokenEndpoint: authMetadata.token_endpoint.toString(),
    tokenEndpointAuthMethodsSupported: authMetadata.token_endpoint_auth_methods_supported,
  };
  logToolsDebugSafe('oauth_operation_complete', {
    credentialConfigured: !!clientId,
    durationMs: Date.now() - start,
    operation: 'discovery',
    outcome: 'complete',
    registrationAvailable: !!result.registrationEndpoint,
    scopeCount: result.scopesSupported?.length || 0,
  });
  return result;
}
