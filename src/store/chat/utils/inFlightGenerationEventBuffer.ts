import type { ConversationGenerationEvent } from '@lobechat/types';

/** Cap for SSE events buffered while a send enqueue is in flight and not yet attached. */
export const IN_FLIGHT_GENERATION_EVENT_BUFFER_CAP = 50;

const inFlightGenerationEventBuffer: ConversationGenerationEvent[] = [];

export const bufferInFlightGenerationEvent = (event: ConversationGenerationEvent) => {
  inFlightGenerationEventBuffer.push(event);
  if (inFlightGenerationEventBuffer.length > IN_FLIGHT_GENERATION_EVENT_BUFFER_CAP) {
    inFlightGenerationEventBuffer.splice(
      0,
      inFlightGenerationEventBuffer.length - IN_FLIGHT_GENERATION_EVENT_BUFFER_CAP,
    );
  }
};

export const takeInFlightGenerationEvents = (operationId: string) => {
  const matched = inFlightGenerationEventBuffer
    .filter((event) => event.operationId === operationId)
    .sort((a, b) => a.revision - b.revision);

  for (let index = inFlightGenerationEventBuffer.length - 1; index >= 0; index -= 1) {
    if (inFlightGenerationEventBuffer[index].operationId === operationId) {
      inFlightGenerationEventBuffer.splice(index, 1);
    }
  }

  return matched;
};

export const discardInFlightGenerationEvents = (operationId?: string) => {
  if (!operationId) {
    inFlightGenerationEventBuffer.length = 0;
    return;
  }

  for (let index = inFlightGenerationEventBuffer.length - 1; index >= 0; index -= 1) {
    if (inFlightGenerationEventBuffer[index].operationId === operationId) {
      inFlightGenerationEventBuffer.splice(index, 1);
    }
  }
};

export const hasBufferedInFlightGenerationEvents = () => inFlightGenerationEventBuffer.length > 0;
