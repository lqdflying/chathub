import { isDesktop } from '@/const/version';

import { ClientSkillService } from './client';
import { ServerSkillService } from './server';

export * from './activation';
export * from './parser';
export * from './registry';
export * from './type';

export const skillService =
  process.env.NEXT_PUBLIC_SERVICE_MODE === 'server' || isDesktop
    ? new ServerSkillService()
    : new ClientSkillService();
