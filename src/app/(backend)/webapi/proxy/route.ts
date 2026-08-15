import { NextResponse } from 'next/server';
import { ssrfSafeFetch } from 'ssrf-safe-fetch';

import {
  createWebApiAuthErrorResponse,
  resolveWebApiAuthFromHeader,
} from '@/app/(backend)/middleware/auth/utils';

/**
 * just for a proxy
 */
export const POST = async (req: Request) => {
  try {
    await resolveWebApiAuthFromHeader(req);
  } catch (error) {
    return createWebApiAuthErrorResponse(error);
  }

  const url = await req.text();

  try {
    const res = await ssrfSafeFetch(url);
    // Forward the upstream status, statusText and the ACTUAL Headers collection.
    // `new Response(body)` alone defaults to 200, and `{ ...res.headers }` drops
    // every header (Headers entries aren't enumerable own-properties) — both of
    // which would make an upstream 404/500 look like a successful image download.
    return new Response(res.ok ? await res.arrayBuffer() : await res.text(), {
      headers: res.headers,
      status: res.status,
      statusText: res.statusText,
    });
  } catch (err) {
    console.error(err); // DNS lookup 127.0.0.1(family:4, host:127.0.0.1.nip.io) is not allowed. Because, It is private IP address.
    return NextResponse.json({ error: 'Not support internal host proxy' }, { status: 400 });
  }
};
