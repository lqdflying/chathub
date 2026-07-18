import {
  GetStreamableMcpServerManifestInputSchema,
  StreamableHTTPAuthSchema,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { isDesktop, isServerMode } from '@/const/version';
import { CHATHUB_TOOLS_DIAGNOSTIC_ID_PATTERN } from '@/const/tools';
import {
  describeToolsDebugError,
  logToolsDebugSafe,
  summarizeToolsDebugValue,
} from '@/libs/logger/toolsDebug';
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
      const startedAt = Date.now();
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

      try {
        const serialized = JSON.stringify(data);
        logToolsDebugSafe('call_tool_complete', {
          durationMs: Date.now() - startedAt,
          phase: 'serialization',
          response: summarizeToolsDebugValue(serialized),
          toolName: input.toolName,
        });
        return serialized;
      } catch (error) {
        logToolsDebugSafe('call_tool_failed', {
          ...describeToolsDebugError(error),
          durationMs: Date.now() - startedAt,
          failurePhase: 'serialization',
          toolName: input.toolName,
        });
        throw error;
      }
    }),

  reportClientFailure: mcpProcedure
    .input(
      z.object({
        bodyBytes: z.number().int().nonnegative().optional(),
        bodyKind: z.enum([
          'empty',
          'html',
          'invalid_json',
          'network_error',
          'truncated_json',
          'unreadable',
          'unexpected_text',
        ]),
        contentEncoding: z.string().max(80).optional(),
        contentLength: z.number().int().nonnegative().optional(),
        diagnosticId: z.string().regex(CHATHUB_TOOLS_DIAGNOSTIC_ID_PATTERN),
        durationMs: z.number().int().nonnegative(),
        errorClass: z.enum(['Error', 'NetworkError', 'OtherError', 'TimeoutError', 'TypeError']).optional(),
        errorCode: z.string().regex(/^[A-Z][\dA-Z_]{1,40}$/).optional(),
        failurePhase: z.enum(['network', 'response_parse', 'response_read']),
        fingerprintBytes: z.number().int().nonnegative().optional(),
        fingerprintTruncated: z.boolean().optional(),
        firstCharacterClass: z.string().max(40).optional(),
        gateway: z
          .object({
            cacheStatus: z.string().max(160).optional(),
            requestIdHash: z.string().regex(/^[\da-f]{16}$/).optional(),
            server: z.string().max(160).optional(),
            upstreamDurationMs: z.number().int().nonnegative().optional(),
            via: z.string().max(160).optional(),
          })
          .optional(),
        htmlMarker: z.enum(['doctype', 'html_tag', 'less_than_prefix']).optional(),
        httpStatus: z.number().int().min(100).max(599).optional(),
        lastCharacterClass: z.string().max(40).optional(),
        mediaType: z.string().max(120).optional(),
        networkOnline: z.boolean().optional(),
        reason: z.enum(['network_error', 'response_parse_failed', 'response_read_failed']),
        responseFingerprint: z.string().regex(/^[\da-f]{16}$/).optional(),
        timedOut: z.boolean().optional(),
      }),
    )
    .mutation(({ input }) => {
      logToolsDebugSafe('client_rpc_response_failed', {
        ...input,
        operation: 'call_tool',
        procedure: 'mcp.callTool',
      });
      return { reported: true };
    }),
});
