import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

import {
  createWebApiAuthErrorResponse,
  resolveWebApiAuthFromHeader,
} from '@/app/(backend)/middleware/auth/utils';
import { ApiTesterRequestSchema, executeApiTesterRequest } from '@/server/services/apiTester';

export const runtime = 'nodejs';

const SERVER_REQUEST_TIMEOUT_MS = 60_000;

const anySignal = (signals: AbortSignal[]): AbortSignal => {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(signals);

  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const signal of signals) {
    if (signal.aborted) {
      abort();
      break;
    }
    signal.addEventListener('abort', abort, { once: true });
  }
  return controller.signal;
};

export const POST = async (req: Request) => {
  try {
    await resolveWebApiAuthFromHeader(req);
  } catch (error) {
    return createWebApiAuthErrorResponse(error);
  }

  try {
    const payload = ApiTesterRequestSchema.parse(await req.json());
    const timeoutSignal = AbortSignal.timeout(SERVER_REQUEST_TIMEOUT_MS);
    const response = await executeApiTesterRequest(payload, {
      signal: anySignal([req.signal, timeoutSignal]),
    });

    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: 'Invalid API Tester request', issues: error.issues },
        { status: 400 },
      );
    }

    const message = error instanceof Error ? error.message : 'API Tester proxy request failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
};
