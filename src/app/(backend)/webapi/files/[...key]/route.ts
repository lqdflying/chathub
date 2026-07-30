import { NextRequest, NextResponse } from 'next/server';

import { getServerDB } from '@/database/server';
import { createLambdaContext } from '@/libs/trpc/lambda/context';
import { S3 } from '@/server/modules/S3';
import { FileService } from '@/server/services/file';
import { isValidFileProxyKeySegments } from '@/server/services/file/fileReference';

const CONTENT_TYPE_MAP: Record<string, string> = {
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  pdf: 'application/pdf',
  png: 'image/png',
  svg: 'image/svg+xml',
  txt: 'text/plain',
  webp: 'image/webp',
};

export const GET = async (req: NextRequest, { params }: { params: Promise<{ key: string[] }> }) => {
  // Require authenticated user — reuses all existing auth methods (OIDC, Clerk, NextAuth)
  const ctx = await createLambdaContext(req);
  if (!ctx.userId) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const { key } = await params;
  // Next.js decodes catch-all segments, so encoded traversal arrives as literal '..'/'/'
  // segments — reject the same shapes the proxy-URL decoder rejects before touching the DB
  if (!isValidFileProxyKeySegments(key)) {
    return new NextResponse('File not found', { status: 404 });
  }
  const fileKey = key.join('/');

  // Only serve objects the requesting user owns — otherwise any authenticated user could
  // read another user's files by key (the proxy URL exposes the bare key).
  const serverDB = await getServerDB();
  const fileService = new FileService(serverDB, ctx.userId);
  if (!(await fileService.isKeyOwnedByUser(fileKey))) {
    return new NextResponse('File not found', { status: 404 });
  }

  try {
    const s3 = new S3();
    const bytes = await s3.getFileByteArray(fileKey);

    const ext = fileKey.split('.').pop()?.toLowerCase() ?? '';
    const contentType = CONTENT_TYPE_MAP[ext] ?? 'application/octet-stream';

    return new Response(bytes, {
      headers: {
        'Cache-Control': 'private, max-age=3600',
        'Content-Type': contentType,
      },
    });
  } catch (e) {
    console.error('[file-proxy] error fetching key:', fileKey, e);
    return new NextResponse('File not found', { status: 404 });
  }
};
