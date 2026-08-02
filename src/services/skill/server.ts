import { lambdaClient } from '@/libs/trpc/client';

import { InstallSkillParams, SkillService } from './type';

export class ServerSkillService implements SkillService {
  getInstalledSkills = () => lambdaClient.skill.getInstalledSkills.query();
  getSkill = (identifier: string) => lambdaClient.skill.getSkill.query({ identifier });
  installSkill = (params: InstallSkillParams) => lambdaClient.skill.installSkill.mutate(params);
  installSkillFromUrl: SkillService['installSkillFromUrl'] = (params) =>
    lambdaClient.skill.installSkillFromUrl.mutate(params);
  resolveSkills: SkillService['resolveSkills'] = (identifiers) =>
    lambdaClient.skill.resolveSkills.query({ identifiers });
  searchRegistry: SkillService['searchRegistry'] = (query) =>
    lambdaClient.skill.searchRegistry.query({ query });
  uninstallSkill = async (identifier: string) => {
    await lambdaClient.skill.removeSkill.mutate({ identifier });
  };
}
