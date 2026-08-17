export const CONVERSATION_GENERATION_TASK = 'conversation_generation';

export const CONVERSATION_GENERATION_CHECKPOINT_MS = 250;
export const CONVERSATION_GENERATION_CHECKPOINT_CHARS = 32;
export const CONVERSATION_GENERATION_SSE_HEARTBEAT_MS = 15_000;
export const CONVERSATION_GENERATION_EVENT_PAGE_SIZE = 200;
export const CONVERSATION_GENERATION_SWEEP_INTERVAL_MS = 15_000;
export const CONVERSATION_GENERATION_HEARTBEAT_MS = 10_000;
export const CONVERSATION_GENERATION_STALE_PROCESSING_MS = 90_000;
export const CONVERSATION_GENERATION_MAX_ATTEMPTS = 8;
export const CONVERSATION_GENERATION_MAX_TOOL_TURNS = 8;

export const FETCH_ON_CLIENT_ERROR =
  'This model is configured to run in the browser and no server-reachable API credentials were found. Durable background generation requires a provider API key on the server.';
