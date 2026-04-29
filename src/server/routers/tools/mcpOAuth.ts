import { z } from 'zod';

import { isServerMode } from '@/const/version';
import { passwordProcedure } from '@/libs/trpc/edge';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { McpOAuthService } from '@/server/services/mcp/oauth';
import { discoverOAuthMetadata } from '@/server/services/mcp/oauthDiscovery';

const mcpOAuthProcedure = isServerMode ? authedProcedure : passwordProcedure;

const oauthProcedure = mcpOAuthProcedure.use(serverDatabase).use(async (opts) => {
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
        serverUrl: z.string().url(),
        clientName: z.string().optional(),
        redirectUri: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      return discoverOAuthMetadata(input.serverUrl, input.clientName, input.redirectUri);
    }),

  initiateOAuth: oauthProcedure
    .input(
      z.object({
        pluginIdentifier: z.string().min(1),
        clientId: z.string().min(1),
        authorizationEndpoint: z.string().url(),
        tokenEndpoint: z.string().url(),
        redirectUri: z.string(),
        scope: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (!ctx.userId) throw new Error('User not authenticated');

      return ctx.mcpOAuthService.initiateOAuth(ctx.userId, {
        authorizationEndpoint: input.authorizationEndpoint,
        clientId: input.clientId,
        pluginIdentifier: input.pluginIdentifier,
        redirectUri: input.redirectUri,
        scope: input.scope,
        tokenEndpoint: input.tokenEndpoint,
      });
    }),

  oauthCallback: oauthProcedure
    .input(
      z.object({
        code: z.string().min(1),
        state: z.string().min(1),
        error: z.string().optional(),
        error_description: z.string().optional(),
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
