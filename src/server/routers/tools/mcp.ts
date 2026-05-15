import {
  GetStreamableMcpServerManifestInputSchema,
  StreamableHTTPAuthSchema,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { isDesktop, isServerMode } from '@/const/version';
import { passwordProcedure } from '@/libs/trpc/edge';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { mcpService, type MCPOAuthContext } from '@/server/services/mcp';
import { McpOAuthService } from '@/server/services/mcp/oauth';

// Define Zod schemas for MCP Client parameters
const httpParamsSchema = z.object({
  auth: StreamableHTTPAuthSchema,
  headers: z.record(z.string()).optional(),
  name: z.string().min(1),
  type: z.literal('http'),
  url: z.string().url(),
});

const stdioParamsSchema = z.object({
  args: z.array(z.string()).optional().default([]),
  command: z.string().min(1),
  name: z.string().min(1),
  type: z.literal('stdio'),
});

// Union schema for MCPClientParams
const mcpClientParamsSchema = z.union([httpParamsSchema, stdioParamsSchema]);

const checkStdioEnvironment = (params: z.infer<typeof mcpClientParamsSchema>) => {
  if (params.type === 'stdio' && !isDesktop) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Stdio MCP type is not supported in web environment.',
    });
  }
};

const mcpProcedure = isServerMode ? authedProcedure : passwordProcedure;

export const mcpRouter = router({
  getStreamableMcpServerManifest: mcpProcedure
    .input(GetStreamableMcpServerManifestInputSchema)
    .use(serverDatabase)
    .query(async ({ input, ctx }) => {
      let resolvedAuth = input.auth;

      // For OAuth 2.1 plugins, inject the stored access token before
      // connecting to the MCP server.  The token was saved during the
      // OAuth callback flow but the client doesn't have it in-memory.
      let oauthContext: MCPOAuthContext | undefined;

      if (input.auth?.type === 'oauth2') {
        const oauthService = new McpOAuthService(ctx.serverDB);
        const token = await oauthService.getOAuthToken(ctx.userId!, input.identifier);
        if (token?.accessToken) {
          resolvedAuth = { ...input.auth, accessToken: token.accessToken };
        }
        oauthContext = { oauthService, pluginIdentifier: input.identifier, userId: ctx.userId! };
      }

      return await mcpService.getStreamableMcpServerManifest(
        input.identifier,
        input.url,
        input.metadata,
        resolvedAuth,
        input.headers,
        oauthContext,
      );
    }),
  /* eslint-disable sort-keys-fix/sort-keys-fix */
  // --- MCP Interaction ---
  // listTools now accepts MCPClientParams directly
  listTools: mcpProcedure
    .input(mcpClientParamsSchema)
    .use(serverDatabase)
    .query(async ({ input, ctx }) => {
      checkStdioEnvironment(input);

      let resolvedParams = input;
      let oauthContext: MCPOAuthContext | undefined;

      if (input.type === 'http' && input.auth?.type === 'oauth2') {
        const oauthService = new McpOAuthService(ctx.serverDB);
        const token = await oauthService.getOAuthToken(ctx.userId!, input.name);
        if (token?.accessToken) {
          resolvedParams = { ...input, auth: { ...input.auth, accessToken: token.accessToken } };
        }
        oauthContext = { oauthService, pluginIdentifier: input.name, userId: ctx.userId! };
      }

      return await mcpService.listTools(resolvedParams, {}, oauthContext);
    }),

  // listResources now accepts MCPClientParams directly
  listResources: mcpProcedure
    .input(mcpClientParamsSchema)
    .use(serverDatabase)
    .query(async ({ input, ctx }) => {
      checkStdioEnvironment(input);

      let resolvedParams = input;
      let oauthContext: MCPOAuthContext | undefined;

      if (input.type === 'http' && input.auth?.type === 'oauth2') {
        const oauthService = new McpOAuthService(ctx.serverDB);
        const token = await oauthService.getOAuthToken(ctx.userId!, input.name);
        if (token?.accessToken) {
          resolvedParams = { ...input, auth: { ...input.auth, accessToken: token.accessToken } };
        }
        oauthContext = { oauthService, pluginIdentifier: input.name, userId: ctx.userId! };
      }

      return await mcpService.listResources(resolvedParams, oauthContext);
    }),

  // listPrompts now accepts MCPClientParams directly
  listPrompts: mcpProcedure
    .input(mcpClientParamsSchema)
    .use(serverDatabase)
    .query(async ({ input, ctx }) => {
      checkStdioEnvironment(input);

      let resolvedParams = input;
      let oauthContext: MCPOAuthContext | undefined;

      if (input.type === 'http' && input.auth?.type === 'oauth2') {
        const oauthService = new McpOAuthService(ctx.serverDB);
        const token = await oauthService.getOAuthToken(ctx.userId!, input.name);
        if (token?.accessToken) {
          resolvedParams = { ...input, auth: { ...input.auth, accessToken: token.accessToken } };
        }
        oauthContext = { oauthService, pluginIdentifier: input.name, userId: ctx.userId! };
      }

      return await mcpService.listPrompts(resolvedParams, oauthContext);
    }),

  // callTool now accepts MCPClientParams, toolName, and args
  callTool: mcpProcedure
    .input(
      z.object({
        params: mcpClientParamsSchema,
        args: z.any(),
        toolName: z.string(),
      }),
    )
    .use(serverDatabase)
    .mutation(async ({ input, ctx }) => {
      checkStdioEnvironment(input.params);

      let resolvedParams = input.params;
      let oauthContext: MCPOAuthContext | undefined;

      if (input.params.type === 'http' && input.params.auth?.type === 'oauth2') {
        const oauthService = new McpOAuthService(ctx.serverDB);
        const token = await oauthService.getOAuthToken(ctx.userId!, input.params.name);
        if (token?.accessToken) {
          resolvedParams = { ...input.params, auth: { ...input.params.auth, accessToken: token.accessToken } };
        }
        oauthContext = { oauthService, pluginIdentifier: input.params.name, userId: ctx.userId! };
      }

      const data = await mcpService.callTool(resolvedParams, input.toolName, input.args, oauthContext);

      return JSON.stringify(data);
    }),
});
