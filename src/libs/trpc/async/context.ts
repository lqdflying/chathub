import { LobeChatDatabase } from '@lobechat/database';
import { ClientSecretPayload } from '@lobechat/types';
import debug from 'debug';
import { NextRequest } from 'next/server';

import { serverDBEnv } from '@/config/db';
import { LOBE_CHAT_AUTH_HEADER } from '@/const/auth';
import {
  CHATHUB_IMAGE_DIAGNOSTIC_HEADER,
  CHATHUB_KNOWLEDGE_DIAGNOSTIC_HEADER,
} from '@/const/tools';
import { normalizeImageDiagnosticId } from '@/libs/logger/imageDebug';
import { normalizeKnowledgeDiagnosticId } from '@/libs/logger/knowledgeDebug';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

const log = debug('lobe-async:context');

export interface AsyncAuthContext {
  imageDiagnosticId?: string;
  jwtPayload: ClientSecretPayload;
  knowledgeDiagnosticId?: string;
  secret: string;
  serverDB?: LobeChatDatabase;
  userId?: string | null;
}

/**
 * Inner function for `createContext` where we create the context.
 * This is useful for testing when we don't want to mock Next.js' request/response
 */
export const createAsyncContextInner = async (params?: {
  imageDiagnosticId?: string;
  jwtPayload?: ClientSecretPayload;
  knowledgeDiagnosticId?: string;
  secret?: string;
  userId?: string | null;
}): Promise<AsyncAuthContext> => ({
  imageDiagnosticId: params?.imageDiagnosticId,
  jwtPayload: params?.jwtPayload || {},
  knowledgeDiagnosticId: params?.knowledgeDiagnosticId,
  secret: params?.secret || '',
  userId: params?.userId,
});

export type AsyncContext = Awaited<ReturnType<typeof createAsyncContextInner>>;

const getBearerSecret = (authorization: string | null): string | undefined => {
  if (!authorization) return undefined;

  const [scheme, secret, unexpectedPart] = authorization.trim().split(/\s+/);
  if (scheme.toLowerCase() !== 'bearer' || !secret || unexpectedPart) return undefined;

  return secret;
};

export const getTrustedImageDiagnosticId = (
  request: Pick<NextRequest, 'headers'>,
): string | undefined => {
  const bearerSecret = getBearerSecret(request.headers.get('Authorization'));
  if (!bearerSecret || bearerSecret !== serverDBEnv.KEY_VAULTS_SECRET) return undefined;

  return normalizeImageDiagnosticId(request.headers.get(CHATHUB_IMAGE_DIAGNOSTIC_HEADER));
};

export const getTrustedKnowledgeDiagnosticId = (
  request: Pick<NextRequest, 'headers'>,
): string | undefined => {
  const bearerSecret = getBearerSecret(request.headers.get('Authorization'));
  if (!bearerSecret || bearerSecret !== serverDBEnv.KEY_VAULTS_SECRET) return;

  return normalizeKnowledgeDiagnosticId(request.headers.get(CHATHUB_KNOWLEDGE_DIAGNOSTIC_HEADER));
};

export const createAsyncRouteContext = async (request: NextRequest): Promise<AsyncContext> => {
  // for API-response caching see https://trpc.io/docs/v11/caching

  log('Creating async route context');

  const authorization = request.headers.get('Authorization');
  const lobeChatAuthorization = request.headers.get(LOBE_CHAT_AUTH_HEADER);
  const imageDiagnosticId = getTrustedImageDiagnosticId(request);
  const knowledgeDiagnosticId = getTrustedKnowledgeDiagnosticId(request);

  log('Authorization header present: %s', !!authorization);
  log('LobeChat auth header present: %s', !!lobeChatAuthorization);

  if (!authorization) {
    log('No authorization header found');
    throw new Error('No authorization header found');
  }

  if (!lobeChatAuthorization) {
    log('No LobeChat authorization header found');
    throw new Error('No LobeChat authorization header found');
  }

  const secret = getBearerSecret(authorization);
  log('Secret extracted from authorization header: %s', !!secret);

  try {
    log('Initializing KeyVaultsGateKeeper');
    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();

    log('Decrypting LobeChat authorization');
    const { plaintext } = await gateKeeper.decrypt(lobeChatAuthorization);

    log('Parsing decrypted authorization data');
    const { userId, payload } = JSON.parse(plaintext);

    log(
      'Successfully parsed authorization data - userId: %s, payload keys: %O',
      userId,
      Object.keys(payload || {}),
    );

    return createAsyncContextInner({
      imageDiagnosticId,
      jwtPayload: payload,
      knowledgeDiagnosticId,
      secret,
      userId,
    });
  } catch (error) {
    log('Error creating async route context: %O', error);
    throw error;
  }
};
