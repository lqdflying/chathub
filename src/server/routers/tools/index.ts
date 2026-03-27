import { publicProcedure, router } from '@/libs/trpc/lambda';

import { mcpRouter } from './mcp';
import { minimaxVisionRouter } from './minimaxVision';
import { searchRouter } from './search';

export const toolsRouter = router({
  healthcheck: publicProcedure.query(() => "i'm live!"),
  mcp: mcpRouter,
  minimaxVision: minimaxVisionRouter,
  search: searchRouter,
});

export type ToolsRouter = typeof toolsRouter;
