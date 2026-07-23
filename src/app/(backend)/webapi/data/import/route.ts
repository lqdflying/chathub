import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getServerDB } from '@/database/server';
import { DataImporterRepos } from '@/database/repositories/dataImporter';
import { createLambdaContext } from '@/libs/trpc/lambda/context';
import {
  ConversationWriteRejectedError,
  advanceConversationVersion,
  withConversationWriteLockOrThrow,
} from '@/server/services/conversationWriteLock';
import {
  DataBackupError,
  parseAndPreflightDatabaseBackup,
} from '@/server/services/dataBackup';
import { DataImportStrategy } from '@/types/export';
import { ImporterEntryData } from '@/types/importer';

const legacyImportSchema = z.object({
  messages: z.array(z.record(z.string(), z.unknown())).optional(),
  sessionGroups: z.array(z.record(z.string(), z.unknown())).optional(),
  sessions: z.array(z.record(z.string(), z.unknown())).optional(),
  topics: z.array(z.record(z.string(), z.unknown())).optional(),
  version: z.number(),
});

const errorResponse = (code: string, message: string, status: number) =>
  NextResponse.json({ code, message }, { status });

export const POST = async (request: NextRequest) => {
  const context = await createLambdaContext(request);
  if (!context.userId) {
    return errorResponse('UNAUTHORIZED', 'Authentication is required.', 401);
  }

  const strategyParam = request.nextUrl.searchParams.get('strategy') || 'merge';
  if (strategyParam !== 'merge' && strategyParam !== 'replace') {
    return errorResponse('INVALID_STRATEGY', 'Import strategy must be merge or replace.', 400);
  }
  const strategy = strategyParam as DataImportStrategy;

  const expectedVersionParam = request.nextUrl.searchParams.get('expectedConversationVersion');
  const expectedConversationVersion =
    expectedVersionParam === null ? undefined : Number(expectedVersionParam);
  if (
    expectedConversationVersion !== undefined &&
    (!Number.isSafeInteger(expectedConversationVersion) || expectedConversationVersion < 0)
  ) {
    return errorResponse(
      'INVALID_CONVERSATION_VERSION',
      'Expected conversation version must be a non-negative integer.',
      400,
    );
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return errorResponse('INVALID_BACKUP', 'The selected file is not valid JSON.', 400);
  }

  try {
    const database = await getServerDB();
    const looksLikeDatabaseBackup =
      !!input &&
      typeof input === 'object' &&
      !Array.isArray(input) &&
      ('schemaHash' in input || 'formatVersion' in input);

    if (!looksLikeDatabaseBackup) {
      const legacyResult = legacyImportSchema.safeParse(input);

      if (legacyResult.success) {
        const result = await withConversationWriteLockOrThrow(
          database,
          context.userId,
          async (transaction) => {
            const importResult = await new DataImporterRepos(
              transaction as typeof database,
              context.userId!,
            ).importData(legacyResult.data as ImporterEntryData);

            if (!importResult.success) throw new Error(importResult.error.message);
            await advanceConversationVersion(transaction, context.userId!);
            return importResult;
          },
          expectedConversationVersion,
        );

        return NextResponse.json(result);
      }
    }

    const { backup, ignoredTables } = await parseAndPreflightDatabaseBackup(input, database);
    const result = await withConversationWriteLockOrThrow(
      database,
      context.userId,
      async (transaction) => {
        const importResult = await new DataImporterRepos(
          transaction as typeof database,
          context.userId!,
        ).importPgDataInTransaction(backup, strategy);

        if (!importResult.success) throw new Error(importResult.error.message);
        await advanceConversationVersion(transaction, context.userId!);
        return importResult;
      },
      expectedConversationVersion,
    );

    return NextResponse.json({ ...result, ignoredTables });
  } catch (error) {
    if (error instanceof DataBackupError) {
      return errorResponse(error.code, error.message, error.status);
    }

    if (error instanceof ConversationWriteRejectedError) {
      return errorResponse(
        'CONVERSATION_VERSION_CONFLICT',
        'Conversation data changed after the import started. Please retry with a fresh backup preview.',
        409,
      );
    }

    console.error('[data-backup] import rolled back:', error);
    return errorResponse(
      'IMPORT_FAILED_ROLLED_BACK',
      'Import failed and all database changes were rolled back.',
      500,
    );
  }
};
