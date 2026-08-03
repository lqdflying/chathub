import { TRPCError } from '@trpc/server';
import { serialize } from 'cookie';
import debug from 'debug';
import { z } from 'zod';

import { publicProcedure, router } from '@/libs/trpc/lambda';
import { DiscoverService } from '@/server/services/discover';
import { McpSorts, PluginSorts } from '@/types/discover';

const log = debug('lambda-router:market');

const marketProcedure = publicProcedure.use(async ({ ctx, next }) => {
  return next({
    ctx: {
      discoverService: new DiscoverService({ accessToken: ctx.marketAccessToken }),
    },
  });
});

export const marketRouter = router({
  // ============================== MCP Market ==============================
  getMcpCategories: marketProcedure
    .input(
      z
        .object({
          locale: z.string().optional(),
          q: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      log('getMcpCategories input: %O', input);

      try {
        return await ctx.discoverService.getMcpCategories(input);
      } catch (error) {
        log('Error fetching mcp categories: %O', error);
        return [];
      }
    }),

  getMcpDetail: marketProcedure
    .input(
      z.object({
        identifier: z.string(),
        locale: z.string().optional(),
        version: z.string().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      log('getMcpDetail input: %O', input);

      try {
        return await ctx.discoverService.getMcpDetail(input);
      } catch (error) {
        console.error('Error fetching mcp detail: %O', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch mcp detail',
        });
      }
    }),

  getMcpList: marketProcedure
    .input(
      z
        .object({
          category: z.string().optional(),
          locale: z.string().optional(),
          order: z.enum(['asc', 'desc']).optional(),
          page: z.number().optional(),
          pageSize: z.number().optional(),
          q: z.string().optional(),
          sort: z.nativeEnum(McpSorts).optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      log('getMcpList input: %O', input);

      try {
        return await ctx.discoverService.getMcpList(input);
      } catch (error) {
        log('Error fetching mcp list: %O', error);
        return { categories: [], currentPage: 1, items: [], pageSize: 20, totalCount: 0, totalPages: 0 };
      }
    }),

  getMcpManifest: marketProcedure
    .input(
      z.object({
        identifier: z.string(),
        install: z.boolean().optional(),
        locale: z.string().optional(),
        version: z.string().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      log('getMcpManifest input: %O', input);

      try {
        return await ctx.discoverService.getMcpManifest(input);
      } catch (error) {
        log('Error fetching mcp manifest: %O', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch mcp manifest',
        });
      }
    }),

  // ============================== Plugin Market ==============================
  getLegacyPluginList: marketProcedure
    .input(
      z
        .object({
          locale: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      log('getLegacyPluginList input: %O', input);
      try {
        return await ctx.discoverService.getLegacyPluginList(input);
      } catch (error) {
        log('Error fetching legacy plugin list: %O', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch plugin list',
        });
      }
    }),

  getPluginCategories: marketProcedure
    .input(
      z
        .object({
          locale: z.string().optional(),
          q: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      log('getPluginCategories input: %O', input);

      try {
        return await ctx.discoverService.getPluginCategories(input);
      } catch (error) {
        log('Error fetching plugin categories: %O', error);
        return [];
      }
    }),

  getPluginDetail: marketProcedure
    .input(
      z.object({
        identifier: z.string(),
        locale: z.string().optional(),
        withManifest: z.boolean().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      log('getPluginDetail input: %O', input);

      try {
        return await ctx.discoverService.getPluginDetail(input);
      } catch (error) {
        log('Error fetching plugin details: %O', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch plugin details',
        });
      }
    }),

  getPluginIdentifiers: marketProcedure.query(async ({ ctx }) => {
    log('getPluginIdentifiers called');

    try {
      return await ctx.discoverService.getPluginIdentifiers();
    } catch (error) {
      log('Error fetching plugin identifiers: %O', error);
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to fetch plugin identifiers',
      });
    }
  }),

  getPluginList: marketProcedure
    .input(
      z
        .object({
          category: z.string().optional(),
          locale: z.string().optional(),
          order: z.enum(['asc', 'desc']).optional(),
          page: z.number().optional(),
          pageSize: z.number().optional(),
          q: z.string().optional(),
          sort: z.nativeEnum(PluginSorts).optional(),
        })
        .optional(),
    )
    .query(async ({ input, ctx }) => {
      log('getPluginList input: %O', input);

      try {
        return await ctx.discoverService.getPluginList(input);
      } catch (error) {
        log('Error fetching plugin list: %O', error);
        return { categories: [], currentPage: 1, items: [], pageSize: 20, totalCount: 0, totalPages: 0 };
      }
    }),

  registerClientInMarketplace: marketProcedure.input(z.object({})).mutation(async ({ ctx }) => {
    return ctx.discoverService.registerClient({
      userAgent: ctx.userAgent,
    });
  }),

  registerM2MToken: marketProcedure
    .input(
      z.object({
        clientId: z.string(),
        clientSecret: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      log('registerM2MToken input: %O', { clientId: input.clientId, clientSecret: '[HIDDEN]' });

      try {
        const { accessToken, expiresIn } = await ctx.discoverService.fetchM2MToken(input);

        // check accessToken
        if (!accessToken) {
          // clean Cookies

          ctx.resHeaders?.append('Set-Cookie', serialize('mp_token_status', '', { maxAge: -1 }));
          ctx.resHeaders?.append('Set-Cookie', serialize('mp_token', '', { maxAge: -1 }));

          return { success: false };
        }

        log('get access token, expiresIn value:', expiresIn);
        log('expiresIn type:', typeof expiresIn);

        const expirationTime = new Date(Date.now() + (expiresIn - 60) * 1000); // 提前 60 秒过期

        log('expirationTime:', expirationTime.toISOString());

        // 设置 HTTP-Only Cookie 存储实际的 access token
        const tokenCookie = serialize('mp_token', accessToken, {
          expires: expirationTime,
          httpOnly: true,
          path: '/',
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
        });

        // 设置客户端可读的状态标记 cookie（不包含实际 token）
        const statusCookie = serialize('mp_token_status', 'active', {
          expires: expirationTime,
          httpOnly: false,
          path: '/',
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
        });

        // 通过 context 的 resHeaders 设置 Set-Cookie 头
        ctx.resHeaders?.append('Set-Cookie', tokenCookie);
        ctx.resHeaders?.append('Set-Cookie', statusCookie);

        return {
          expiresIn: expiresIn - 60,
          success: true,
        };
      } catch (error) {
        console.error('Error fetching M2M token: %O', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch M2M token',
        });
      }
    }),

  // ============================== Analytics ==============================

  reportCall: marketProcedure
    .input(
      z.object({
        callDurationMs: z.number(),
        clientId: z.string().optional(),
        customPluginInfo: z.any().optional(),
        errorCode: z.string().optional(),
        errorMessage: z.string().optional(),
        identifier: z.string(),
        isCustomPlugin: z.boolean().optional(),
        metadata: z.record(z.any()).optional(),
        methodName: z.string(),
        methodType: z.enum(['tool', 'prompt', 'resource']),
        platform: z.string().optional(),
        requestSizeBytes: z.number().optional(),
        responseSizeBytes: z.number().optional(),
        sessionId: z.string().optional(),
        success: z.boolean(),
        traceId: z.string().optional(),
        userAgent: z.string().optional(),
        version: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      log('reportCall input: %O', input);
      try {
        await ctx.discoverService.reportCall({
          ...input,
          platform: 'web',
          userAgent: ctx.userAgent,
        });
        return { success: true };
      } catch (error) {
        console.error('Error reporting call: %O', error);
        // 不抛出错误，因为上报失败不应影响主流程
        return { success: false };
      }
    }),

  reportMcpInstallResult: marketProcedure
    .input(
      z.object({
        errorCode: z.any().optional(),
        errorMessage: z.any().optional(),
        identifier: z.string(),
        installDurationMs: z.number().optional(),
        installParams: z.any().optional(),
        manifest: z.any().optional(),
        metadata: z.any().optional(),
        platform: z.string().optional(),
        success: z.boolean(),
        userAgent: z.string().optional(),
        version: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      log('reportMcpInstallResult input: %O', input);
      try {
        await ctx.discoverService.reportPluginInstallation(input);
        return { success: true };
      } catch (error) {
        log('Error reporting MCP installation result: %O', error);
        // 不抛出错误，因为上报失败不应影响主流程
        return { success: false };
      }
    }),
});
