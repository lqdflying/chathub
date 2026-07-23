import { FetchSSEOptions } from '@lobechat/fetch-sse';
import {
  ContextExportJsonValue,
  ContextExportRequestContext,
  ContextExportRequestMetadata,
  TracePayload,
} from '@lobechat/types';

export interface FetchOptions extends FetchSSEOptions {
  contextExportRequest?: ContextExportRequestContext;
  historySummary?: string;
  isWelcomeQuestion?: boolean;
  onContextEngineered?: (snapshot: {
    engineeredInput: ContextExportJsonValue;
    metadata: ContextExportRequestMetadata;
    request: ContextExportRequestContext;
  }) => void;
  signal?: AbortSignal | undefined;
  trace?: TracePayload;
}
