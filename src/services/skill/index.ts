import { ServerSkillService } from './server';

export * from './parser';
export * from './registry';
export * from './type';

export const skillService = new ServerSkillService();
