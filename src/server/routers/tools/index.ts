import { publicProcedure, router } from '@/libs/trpc/lambda';

import { mcpOAuthRouter } from './mcpOAuth';
import { mcpRouter } from './mcp';
import { searchRouter } from './search';
import { telemetryRouter } from './telemetry';

export const toolsRouter = router({
  healthcheck: publicProcedure.query(() => "i'm live!"),
  mcp: mcpRouter,
  mcpOAuth: mcpOAuthRouter,
  search: searchRouter,
  telemetry: telemetryRouter,
});

export type ToolsRouter = typeof toolsRouter;
