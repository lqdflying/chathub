import debug from 'debug';

import { BaseProvider } from '../base/BaseProvider';
import type { PipelineContext, ProcessorOptions } from '../types';

const log = debug('context-engine:provider:SkillInstructionsProvider');

export interface SkillInstructionItem {
  description: string;
  identifier: string;
  instructions?: string;
  name: string;
}

export interface SkillInstructionsConfig {
  activated?: SkillInstructionItem[];
  available?: SkillInstructionItem[];
}

const formatSkillBlock = (config: SkillInstructionsConfig) => {
  const available = (config.available || [])
    .map(({ description, identifier }) => `- ${identifier}: ${description}`)
    .join('\n');
  const activated = (config.activated || [])
    .filter(({ instructions }) => instructions)
    .map(
      ({ identifier, instructions }) => `<skill name="${identifier}">\n${instructions}\n</skill>`,
    )
    .join('\n\n');

  return [
    available && `<available_skills>\n${available}\n</available_skills>`,
    activated && `<activated_skills>\n${activated}\n</activated_skills>`,
  ]
    .filter(Boolean)
    .join('\n\n');
};

export class SkillInstructionsProvider extends BaseProvider {
  readonly name = 'SkillInstructionsProvider';

  constructor(
    private config: SkillInstructionsConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);
    const formatted = formatSkillBlock(this.config);
    if (!formatted) return this.markAsExecuted(clonedContext);

    const system = clonedContext.messages.find((message) => message.role === 'system');
    if (system) system.content = [system.content, formatted].filter(Boolean).join('\n\n');
    else {
      clonedContext.messages.unshift({
        content: formatted,
        createdAt: Date.now(),
        id: `skills-${Date.now()}`,
        meta: {},
        role: 'system',
        updatedAt: Date.now(),
      });
    }

    clonedContext.metadata.skills = {
      activated: (this.config.activated || []).map(({ identifier }) => identifier),
      available: (this.config.available || []).map(({ identifier }) => identifier),
    };
    log(
      'Injected %d available and %d activated skills',
      this.config.available?.length || 0,
      this.config.activated?.length || 0,
    );
    return this.markAsExecuted(clonedContext);
  }
}
