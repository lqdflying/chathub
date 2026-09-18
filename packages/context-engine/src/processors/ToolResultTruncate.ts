import debug from 'debug';

import { BaseProcessor } from '../base/BaseProcessor';
import type { PipelineContext, ProcessorOptions } from '../types';

const log = debug('context-engine:processor:ToolResultTruncateProcessor');

/**
 * Hard cap for a single non-MCP tool-result message on the wire. Builtin dumps
 * (file reads, code-interpreter logs) are capped. MCP `tools/call` results are
 * never rewritten — the protocol has no result-size limit, and hosts must not
 * invent one (https://modelcontextprotocol.io/specification/2025-11-25/server/tools).
 * For capped rows the function is pure on content, so bytes stay stable per
 * message id and never invalidate the prompt-cache prefix.
 */
export const TOOL_RESULT_CONTENT_MAX_CHARS = 8000;

export const isMcpToolResultMessage = (message: {
  plugin?: { type?: string | null } | null;
}): boolean => message.plugin?.type === 'mcp';

/**
 * Deterministically cap a tool-result body. The same input always yields the
 * same output (content-based, never position- or time-based), which is what
 * keeps the prompt-cache prefix stable: a message capped in turn N is byte
 * identical when replayed in turn N+1.
 */
export const truncateToolResultContent = (
  content: string,
  maxChars: number = TOOL_RESULT_CONTENT_MAX_CHARS,
): string => {
  if (content.length <= maxChars) return content;
  const omitted = content.length - maxChars;
  return `${content.slice(0, maxChars)}\n…[truncated ${omitted} chars]`;
};

/** Wire view for one tool row: MCP stays verbatim, everything else uses the cap. */
export const applyToolResultWireContent = (
  content: string,
  message: { plugin?: { type?: string | null } | null },
  maxChars: number = TOOL_RESULT_CONTENT_MAX_CHARS,
): string => {
  if (isMcpToolResultMessage(message)) return content;
  return truncateToolResultContent(content, maxChars);
};

export interface ToolResultTruncateConfig {
  maxChars?: number;
}

/**
 * Caps oversized tool-result message content at request-assembly time.
 *
 * Runs on the post-HistoryTruncate window and never removes messages, so
 * tool-call/tool-result pairs stay atomic. Stored messages keep full content;
 * this is a wire-only view.
 */
export class ToolResultTruncateProcessor extends BaseProcessor {
  readonly name = 'ToolResultTruncateProcessor';

  constructor(
    private config: ToolResultTruncateConfig = {},
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);

    let truncatedCount = 0;

    clonedContext.messages = clonedContext.messages.map((message: any) => {
      if (message?.role !== 'tool' || typeof message.content !== 'string') return message;
      const nextContent = applyToolResultWireContent(message.content, message, this.config.maxChars);
      if (nextContent === message.content) return message;
      truncatedCount += 1;
      return { ...message, content: nextContent };
    });

    clonedContext.metadata.toolResultsTruncated = truncatedCount;

    if (truncatedCount > 0) {
      log(`Truncated ${truncatedCount} oversized tool result(s)`);
    }

    return this.markAsExecuted(clonedContext);
  }
}
