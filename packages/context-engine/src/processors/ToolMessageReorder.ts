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
   */
  private reorderToolMessages(messages: any[]): any[] {
    // 1. 先收集所有 assistant 消息中的有效 tool_call_id
    const validToolCallIds = new Set<string>();
    messages.forEach((message) => {
      if (message.role === 'assistant' && message.tool_calls) {
        message.tool_calls.forEach((toolCall: any) => {
          validToolCallIds.add(toolCall.id);
        });
      }
    });

    // 2. 收集所有有效的 tool 消息，并记录其 tool_call_id 用于回填 assistant
    const toolMessages: Record<string, any> = {};
    const answeredToolCallIds = new Set<string>();
    messages.forEach((message) => {
      if (
        message.role === 'tool' &&
        message.tool_call_id &&
        validToolCallIds.has(message.tool_call_id)
      ) {
        toolMessages[message.tool_call_id] = message;
        answeredToolCallIds.add(message.tool_call_id);
      }
    });

    // 3. 重新排序消息
    const reorderedMessages: any[] = [];
    messages.forEach((message) => {
      // 跳过无效的 tool 消息
      if (
        message.role === 'tool' &&
        (!message.tool_call_id || !validToolCallIds.has(message.tool_call_id))
      ) {
        log('Skipping invalid tool message:', message.id);
        return;
      }

      // 检查是否已经添加过该 tool 消息
      const hasPushed = reorderedMessages.some(
        (m) => !!message.tool_call_id && m.tool_call_id === message.tool_call_id,
      );

      if (hasPushed) return;

      // 对于带有 tool_calls 的 assistant 消息，过滤掉没有对应 tool 响应的 tool_call。
      // 严格的 API（Moonshot/Kimi、OpenAI 等）要求每个 tool_call_id 都必须有一条
      // tool 消息回应，否则会报错：
      //   "an assistant message with 'tool_calls' must be followed by tool messages
      //    responding to each 'tool_call_id'"
      // 孤立的 tool_call 可能来自：MCP 调用被中断、tool 消息被删除、流式 id 不一致等。
      if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
        const validToolCalls = message.tool_calls.filter((toolCall: any) =>
          answeredToolCallIds.has(toolCall.id),
        );

        const droppedCount = message.tool_calls.length - validToolCalls.length;

        if (droppedCount > 0) {
          log(
            'Dropping %d orphan tool_call(s) from assistant message %s',
            droppedCount,
            message.id,
          );
        }

        if (validToolCalls.length === 0) {
          // 所有 tool_call 都没有响应：若消息本身也没有文本内容，则整条丢弃，
          // 否则仅去掉 tool_calls 字段保留为普通 assistant 消息。
          const hasContent =
            typeof message.content === 'string'
              ? message.content.trim().length > 0
              : Array.isArray(message.content)
                ? message.content.length > 0
                : !!message.content;

          if (!hasContent) {
            log('Skipping assistant message with only orphan tool_calls:', message.id);
            return;
          }

          const { tool_calls, ...rest } = message;
          reorderedMessages.push(rest);
          return;
        }

        if (droppedCount > 0) {
          reorderedMessages.push({ ...message, tool_calls: validToolCalls });

          validToolCalls.forEach((toolCall: any) => {
            const correspondingToolMessage = toolMessages[toolCall.id];
            if (correspondingToolMessage) {
              reorderedMessages.push(correspondingToolMessage);
              delete toolMessages[toolCall.id];
            }
          });
          return;
        }
      }

      reorderedMessages.push(message);

      // 如果是 assistant 消息且有 tool_calls，添加对应的 tool 消息
      if (message.role === 'assistant' && message.tool_calls) {
        message.tool_calls.forEach((toolCall: any) => {
          const correspondingToolMessage = toolMessages[toolCall.id];
          if (correspondingToolMessage) {
            reorderedMessages.push(correspondingToolMessage);
            delete toolMessages[toolCall.id];
          }
        });
      }
    });

    return reorderedMessages;
  }

  // 简化：移除验证/统计等辅助方法
}
