import { repairOpenAIChatToolMessageSequence } from '@lobechat/utils';
import debug from 'debug';

import { BaseProcessor } from '../base/BaseProcessor';
import type { PipelineContext, ProcessorOptions } from '../types';

const log = debug('context-engine:processor:ToolMessageReorder');

/**
 * Reorder tool messages to ensure that tool messages are displayed in the correct order.
 * see https://github.com/lobehub/lobe-chat/pull/3155
 */
export class ToolMessageReorder extends BaseProcessor {
  readonly name = 'ToolMessageReorder';

  constructor(options: ProcessorOptions = {}) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);

    // 重新排序消息
    const reorderedMessages = this.reorderToolMessages(clonedContext.messages);

    const originalCount = clonedContext.messages.length;
    const reorderedCount = reorderedMessages.length;

    clonedContext.messages = reorderedMessages;

    // 更新元数据
    clonedContext.metadata.toolMessageReorder = {
      originalCount,
      removedInvalidTools: originalCount - reorderedCount,
      reorderedCount,
    };

    if (originalCount !== reorderedCount) {
      log(
        'Tool message reordering completed, removed',
        originalCount - reorderedCount,
        'invalid tool messages',
      );
    } else {
      log('Tool message reordering completed, message order optimized');
    }

    return this.markAsExecuted(clonedContext);
  }

  /**
   * 重新排序工具消息
   *
   * Tool messages are emitted ONLY by their corresponding assistant message
   * (immediately after it), exactly once, regardless of their original position.
   * This prevents duplication when a tool result appears in the history before
   * the assistant call that produced it — a scenario the previous inline-emit
   * logic duplicated, breaking strict APIs (Moonshot/Kimi, OpenAI) that reject
   * duplicate or out-of-order `tool` messages.
   */
  private reorderToolMessages(messages: any[]): any[] {
    return repairOpenAIChatToolMessageSequence(messages);
  }

  // 简化：移除验证/统计等辅助方法
}
