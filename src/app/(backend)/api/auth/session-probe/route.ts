import { NextResponse } from 'next/server';

import NextAuth from '@/libs/next-auth';

const SESSION_PROBE_HEADERS = {
  'Cache-Control': 'private, no-cache, no-store, max-age=0',
  'Expires': '0',
  'Pragma': 'no-cache',
};

export const GET = async () => {
  const session = await NextAuth.auth();

  return NextResponse.json(
    { userId: session?.user?.id ?? null },
    { headers: SESSION_PROBE_HEADERS },
  );
};
