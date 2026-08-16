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
    // Forward the upstream status/statusText and the raw body bytes, but only a
    // narrow header allowlist. `new Response(body)` alone defaults to 200 (an
    // upstream 404 would look successful), yet reflecting the WHOLE upstream
    // Headers onto this same-origin `/webapi/proxy` response would let a remote
    // server set `Set-Cookie` etc. on the ChatHub origin. Copy only content-type.
    const headers = new Headers();
    const contentType = res.headers.get('content-type');
    if (contentType) headers.set('content-type', contentType);

    return new Response(await res.arrayBuffer(), {
      headers,
      status: res.status,
      statusText: res.statusText,
    });
  } catch (err) {
    console.error(err); // DNS lookup 127.0.0.1(family:4, host:127.0.0.1.nip.io) is not allowed. Because, It is private IP address.
    return NextResponse.json({ error: 'Not support internal host proxy' }, { status: 400 });
  }
};
