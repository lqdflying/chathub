import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { McpOAuthService } from '@/server/services/mcp/oauth';
import { discoverOAuthMetadata } from '@/server/services/mcp/oauthDiscovery';

const oauthProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      mcpOAuthService: new McpOAuthService(ctx.serverDB),
    },
  });
});

export const mcpOAuthRouter = router({
  /**
   * Auto-discover OAuth metadata from an MCP server's well-known endpoints.
   * This eliminates the need for users to manually enter Client ID, Client Secret,
   * Authorization Endpoint, or Token Endpoint.
   */
  discoverOAuth: oauthProcedure
    .input(
      z.object({
        clientName: z.string().optional(),
        redirectUri: z.string().optional(),
        serverUrl: z.string().url(),
      }),
    )
    .mutation(async ({ input }) => {
      return discoverOAuthMetadata(input.serverUrl, input.clientName, input.redirectUri);
    }),

  getOAuthStatus: oauthProcedure
    .input(
      z.object({
        pluginIdentifier: z.string().min(1),
      }),
    )
    .query(async ({ input, ctx }) => {
      if (!ctx.userId) throw new Error('User not authenticated');

      return ctx.mcpOAuthService.getOAuthTokenStatus(ctx.userId, input.pluginIdentifier);
    }),

  getOAuthToken: oauthProcedure
    .input(
      z.object({
        pluginIdentifier: z.string().min(1),
      }),
    )
    .query(async ({ input, ctx }) => {
      if (!ctx.userId) throw new Error('User not authenticated');

      return ctx.mcpOAuthService.getOAuthToken(ctx.userId, input.pluginIdentifier);
    }),

  initiateOAuth: oauthProcedure
    .input(
      z.object({
        authorizationEndpoint: z.string().url(),
        clientId: z.string().min(1),
        clientSecret: z.string().optional(),
        pluginIdentifier: z.string().min(1),
        redirectUri: z.string(),
        scope: z.string().optional(),
        tokenEndpoint: z.string().url(),
        tokenEndpointAuthMethodsSupported: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (!ctx.userId) throw new Error('User not authenticated');

      return ctx.mcpOAuthService.initiateOAuth(ctx.userId, {
        authorizationEndpoint: input.authorizationEndpoint,
        clientId: input.clientId,
        clientSecret: input.clientSecret,
        pluginIdentifier: input.pluginIdentifier,
        redirectUri: input.redirectUri,
        scope: input.scope,
        tokenEndpoint: input.tokenEndpoint,
        tokenEndpointAuthMethodsSupported: input.tokenEndpointAuthMethodsSupported,
      });
    }),

  oauthCallback: oauthProcedure
    .input(
      z.object({
        code: z.string().min(1),
        error: z.string().optional(),
        error_description: z.string().optional(),
        state: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.mcpOAuthService.handleOAuthCallback({
        code: input.code,
        error: input.error,
        error_description: input.error_description,
        state: input.state,
      });
    }),

  revokeOAuthToken: oauthProcedure
    .input(
      z.object({
        pluginIdentifier: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (!ctx.userId) throw new Error('User not authenticated');

      await ctx.mcpOAuthService.revokeOAuthToken(ctx.userId, input.pluginIdentifier);
      return { success: true };
    }),
});

export type McpOAuthRouter = typeof mcpOAuthRouter;
