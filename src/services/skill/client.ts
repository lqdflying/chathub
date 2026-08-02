import { SkillRecord } from '@lobechat/types';

import { clientDB } from '@/database/client/db';
import { SkillModel } from '@/database/models/skill';
import { BaseClientService } from '@/services/baseClientService';

import { normalizeDuplicateSkillContentError } from './errors';
import {
  assertExpectedSkillIdentifier,
  parseSkill,
  resolveSkillSource,
  serializeSkill,
} from './parser';
import { InstallSkillParams, SkillService } from './type';

export class ClientSkillService extends BaseClientService implements SkillService {
  private get model() {
    return new SkillModel(clientDB as any, this.userId);
  }

  getInstalledSkills = () => this.model.query();
  getSkill = async (identifier: string) =>
    this.model.findById(identifier) as Promise<SkillRecord | undefined>;
  installSkill = async (params: InstallSkillParams) => {
    const parsed = parseSkill(params.instructions);
    if (params.sourceUrl && params.sourceType === 'file') {
      throw new Error('Local skill files cannot include a source URL');
    }
    const source =
      params.sourceUrl && params.sourceType !== 'file'
        ? resolveSkillSource(params.sourceUrl, params.sourceType, params.sourceRef)
        : undefined;
    try {
      await this.model.create({
        contentHash: parsed.contentHash,
        description: params.description || parsed.description,
        identifier: params.identifier || parsed.name,
        instructions: parsed.instructions,
        name: params.name || parsed.name,
        sourceRef: source?.sourceRef || params.sourceRef,
        sourceType: source?.sourceType || params.sourceType,
        sourceUrl: source?.sourceUrl,
      });
    } catch (error) {
      throw normalizeDuplicateSkillContentError(error);
    }
    return params.identifier || parsed.name;
  };
  installSkillFromUrl: SkillService['installSkillFromUrl'] = async (params) => {
    const source = resolveSkillSource(params.sourceUrl, params.sourceType, params.sourceRef);
    const response = await fetch(source.sourceUrl, {
      headers: params.authorization ? { authorization: params.authorization } : undefined,
    });
    if (!response.ok) throw new Error(`Skill source returned HTTP ${response.status}`);

    const instructions = await response.text();
    const parsed = parseSkill(instructions);
    assertExpectedSkillIdentifier(parsed.name, params.expectedIdentifier);

    return this.installSkill({
      instructions,
      sourceRef: source.sourceRef,
      sourceType: source.sourceType,
      sourceUrl: source.sourceUrl,
    });
  };
  resolveSkills: SkillService['resolveSkills'] = async (identifiers) => {
    const records = await Promise.all(
      identifiers.map((identifier) => this.model.findById(identifier)),
    );
    return records.filter(Boolean) as SkillRecord[];
  };
  searchRegistry: SkillService['searchRegistry'] = async () => ({ configured: false, items: [] });
  uninstallSkill = async (identifier: string) => {
    await this.model.delete(identifier);
  };
  updateSkill: SkillService['updateSkill'] = async ({ description, identifier, instructions }) => {
    const parsed = parseSkill(serializeSkill({ description, identifier, instructions }));
    let updated;
    try {
      updated = await this.model.update(identifier, {
        contentHash: parsed.contentHash,
        description: parsed.description,
        instructions: parsed.instructions,
      });
    } catch (error) {
      throw normalizeDuplicateSkillContentError(error);
    }
    if (!updated) throw new Error('Skill not found');
  };
}
