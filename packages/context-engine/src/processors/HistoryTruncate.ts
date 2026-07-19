import debug from 'debug';

import { BaseProcessor } from '../base/BaseProcessor';
import type { PipelineContext, ProcessorOptions } from '../types';

const log = debug('context-engine:processor:HistoryTruncateProcessor');

export interface HistoryTruncateConfig {
  /** Whether to enable history count limit */
  enableHistoryCount?: boolean;
  /** Maximum number of historical messages to keep */
  historyCount?: number;
}

/**
 * Slice messages based on history count configuration
 * @param messages Original messages array
 * @param options Configuration options for slicing
 * @returns Sliced messages array
 */
export const getSlicedMessages = (
  messages: any[],
  options: {
    enableHistoryCount?: boolean;
    historyCount?: number;
  },
): any[] => {
  // if historyCount is not enabled, return all messages
  if (!options.enableHistoryCount || options.historyCount === undefined) return messages;

  // if historyCount is negative or set to 0, return empty array
  if (options.historyCount <= 0) return [];

  // Keep the configured history window anchored to the latest user message.
  // Automatic assistant/tool continuations belong to that active turn, so they
  // must extend the existing prefix instead of pushing its oldest messages out.
  const latestUserIndex = messages.findLastIndex((message) => message?.role === 'user');

  // Inputs without a user message are not chat turns; preserve the legacy cap.
  if (latestUserIndex < 0) return messages.slice(-options.historyCount);

  const startIndex = Math.max(0, latestUserIndex + 1 - options.historyCount);

  return messages.slice(startIndex);
};

/**
 * History Truncate Processor
 * Responsible for limiting message history based on configuration
 */
export class HistoryTruncateProcessor extends BaseProcessor {
  readonly name = 'HistoryTruncateProcessor';

  constructor(
    private config: HistoryTruncateConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);

    const originalCount = clonedContext.messages.length;

    // Apply history truncation
    clonedContext.messages = getSlicedMessages(clonedContext.messages, {
      enableHistoryCount: this.config.enableHistoryCount,
      historyCount: this.config.historyCount,
    });

    const finalCount = clonedContext.messages.length;
    const truncatedCount = originalCount - finalCount;

    // Update metadata
    clonedContext.metadata.historyTruncated = truncatedCount;
    clonedContext.metadata.finalMessageCount = finalCount;

    log(
      `History truncation completed, truncated ${truncatedCount} messages (${originalCount} → ${finalCount})`,
    );

    return this.markAsExecuted(clonedContext);
  }
}
