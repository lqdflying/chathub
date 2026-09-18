import { BaseProcessor } from '../base/BaseProcessor';
import type { PipelineContext, ProcessorOptions } from '../types';

/**
 * Historical 8k page budget used by `readMemory` paging only. It is **not**
 * applied to chat/MCP tool results on the provider request. Sending a
 * `…[truncated N chars]` rewrite to the model is wrong: MCP `tools/call` has
 * no result-size limit
 * (https://modelcontextprotocol.io/specification/2025-11-25/server/tools).
 */
export const TOOL_RESULT_CONTENT_MAX_CHARS = 8000;

export const isMcpToolResultMessage = (message: {
  plugin?: { type?: string | null } | null;
}): boolean => message.plugin?.type === 'mcp';

/**
 * Kept for memory-entry page tests. Chat request assembly must not use this
 * on tool results sent to the model.
 */
export const truncateToolResultContent = (
  content: string,
  maxChars: number = TOOL_RESULT_CONTENT_MAX_CHARS,
): string => {
  if (content.length <= maxChars) return content;
  const omitted = content.length - maxChars;
  return `${content.slice(0, maxChars)}\n…[truncated ${omitted} chars]`;
};

/** Wire view: the stored tool body is what the model receives. */
export const applyToolResultWireContent = (
  content: string,
  _message?: { plugin?: { type?: string | null } | null },
): string => content;

export interface ToolResultTruncateConfig {
  maxChars?: number;
}

/**
 * No-op on the chat request. Left in the package so older tests and imports
 * keep compiling; browser and worker pipelines no longer install it.
 */
export class ToolResultTruncateProcessor extends BaseProcessor {
  readonly name = 'ToolResultTruncateProcessor';

  constructor(_config: ToolResultTruncateConfig = {}, options: ProcessorOptions = {}) {
    super(options);
  }

  protected async doProcess(context: PipelineContext): Promise<PipelineContext> {
    const clonedContext = this.cloneContext(context);
    clonedContext.metadata.toolResultsTruncated = 0;
    return this.markAsExecuted(clonedContext);
  }
}
