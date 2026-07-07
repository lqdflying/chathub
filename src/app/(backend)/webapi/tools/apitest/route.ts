import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

import {
  ApiTesterRequestSchema,
  executeApiTesterRequest,
} from '@/server/services/apiTester';

export const runtime = 'nodejs';

export const POST = async (req: Request) => {
  try {
    const payload = ApiTesterRequestSchema.parse(await req.json());
    const response = await executeApiTesterRequest(payload);

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
