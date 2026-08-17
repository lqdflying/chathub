import { NextRequest } from 'next/server';

import { getServerDB } from '@/database/core/db-adaptor';
import { createLambdaContext } from '@/libs/trpc/lambda/context';
import { CONVERSATION_GENERATION_SSE_HEARTBEAT_MS } from '@/server/services/conversationGeneration/constants';
import { isDurableConversationGenerationEnabled } from '@/server/services/conversationGeneration/featureFlag';
import { ConversationGenerationService } from '@/server/services/conversationGeneration/service';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const encoder = new TextEncoder();

const writeSse = (
  controller: ReadableStreamDefaultController<Uint8Array>,
  event: { data: unknown; id?: number | string; type?: string },
) => {
  const chunks = [
    event.id === undefined ? '' : `id: ${event.id}\n`,
    event.type ? `event: ${event.type}\n` : '',
    `data: ${JSON.stringify(event.data)}\n\n`,
  ].join('');
  controller.enqueue(encoder.encode(chunks));
};

export const GET = async (req: NextRequest) => {
  const ctx = await createLambdaContext(req);
  if (!ctx.userId) {
    return new Response(JSON.stringify({ message: 'Authentication is required.' }), {
      headers: { 'Content-Type': 'application/json' },
      status: 401,
    });
  }

  if (!(await isDurableConversationGenerationEnabled(ctx.userId))) {
    return new Response(JSON.stringify({ message: 'Durable conversation generation is disabled.' }), {
      headers: { 'Content-Type': 'application/json' },
      status: 404,
    });
  }

  const db = await getServerDB();
  const service = new ConversationGenerationService(db, ctx.userId);
  const lastEventId = req.headers.get('last-event-id') || req.nextUrl.searchParams.get('cursor');
  let cursor = Number(lastEventId || 0);
  if (!Number.isFinite(cursor) || cursor < 0) cursor = 0;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let heartbeat = Date.now();

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        req.signal.removeEventListener('abort', close);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      const timer = setInterval(async () => {
        if (closed || req.signal.aborted) {
          close();
          return;
        }
        try {
          const page = await service.listEvents(cursor);
          if (page.reset) {
            writeSse(controller, { data: { reset: true }, type: 'reset' });
            cursor = 0;
          }
          for (const event of page.events) {
            writeSse(controller, {
              data: event,
              id: event.id,
              type: event.type,
            });
          }
          cursor = page.cursor;
          if (Date.now() - heartbeat >= CONVERSATION_GENERATION_SSE_HEARTBEAT_MS) {
            controller.enqueue(encoder.encode(': ping\n\n'));
            heartbeat = Date.now();
          }
        } catch (error) {
          if (closed) return;
          writeSse(controller, {
            data: {
              message: error instanceof Error ? error.message : 'Event stream failed',
            },
            type: 'error',
          });
        }
      }, 750);

      req.signal.addEventListener('abort', close);
    },
  });

  return new Response(stream, {
    headers: {
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Accel-Buffering': 'no',
    },
  });
};
