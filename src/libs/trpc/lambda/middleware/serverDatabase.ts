import { getServerDB } from '@/database/core/db-adaptor';
import { pino } from '@/libs/logger';

import { trpc } from '../init';

export const serverDatabase = trpc.middleware(async (opts) => {
  const start = Date.now();
  const serverDB = await getServerDB();
  pino.debug(`Server DB connection established in ${Date.now() - start}ms`);

  return opts.next({
    ctx: { serverDB },
  });
});
