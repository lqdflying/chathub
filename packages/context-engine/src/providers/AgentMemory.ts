import debug from 'debug';

import { BaseProvider } from '../base/BaseProvider';
import type { PipelineContext, ProcessorOptions } from '../types';

const log = debug('context-engine:provider:AgentMemoryProvider');

/**
 * Agent Memory Configuration
 */
export interface AgentMemoryConfig {
  /** Auto-summarized dynamic memory for the target agent */
  dynamicMemory?: string;
  /** User-curated fixed memory for the target agent */
  fixedMemory?: string;
  /** Format both memory tiers into the injected block */
  formatAgentMemory?: (input: { dynamicMemory?: string; fixedMemory?: string }) => string;
}

const defaultAgentMemoryFormatter = ({
  dynamicMemory,
  fixedMemory,
}: {
  dynamicMemory?: string;
  fixedMemory?: string;
}): string =>
  [
    fixedMemory && `<fixed_memory>\n${fixedMemory}\n</fixed_memory>`,
    dynamicMemory && `<dynamic_memory>\n${dynamicMemory}\n</dynamic_memory>`,
  ]
    .filter(Boolean)
    .join('\n');

/**
 * Agent Memory Provider
 * Injects the assistant's two-tier memory (fixed + dynamic) into the system
 * message, right after the agent system role and before more volatile blocks,
 * so the injected prefix stays stable for provider prompt caching.
 */
export class AgentMemoryProvider extends BaseProvider {
  readonly name = 'AgentMemoryProvider';

  constructor(
    private config: AgentMemoryConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);

    const fixedMemory = (this.config.fixedMemory ?? '').trim();
    const dynamicMemory = (this.config.dynamicMemory ?? '').trim();

    if (!fixedMemory && !dynamicMemory) {
      log('No agent memory content, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    const formatter = this.config.formatAgentMemory ?? defaultAgentMemoryFormatter;
    const formatted = formatter({
      dynamicMemory: dynamicMemory || undefined,
      fixedMemory: fixedMemory || undefined,
    }).trim();

    if (!formatted) {
      log('Formatted agent memory is empty, skipping injection');
      return this.markAsExecuted(clonedContext);
    }

    this.injectAgentMemory(clonedContext, formatted);

    clonedContext.metadata.agentMemory = {
      dynamicLength: dynamicMemory.length,
      fixedLength: fixedMemory.length,
      injected: true,
    };

    log(
      `Agent memory injection completed, fixed length: ${fixedMemory.length}, dynamic length: ${dynamicMemory.length}`,
    );
    return this.markAsExecuted(clonedContext);
  }

  private injectAgentMemory(context: PipelineContext, formatted: string): void {
    const existingSystemMessage = context.messages.find((msg) => msg.role === 'system');

    if (existingSystemMessage) {
      existingSystemMessage.content = [existingSystemMessage.content, formatted]
        .filter(Boolean)
        .join('\n\n');

      log(
        `Agent memory merged to existing system message, final length: ${existingSystemMessage.content.length}`,
      );
    } else {
      context.messages.unshift({
        content: formatted,
        role: 'system' as const,
      } as any);
      log(`New agent memory system message created, content length: ${formatted.length}`);
    }
  }
}
