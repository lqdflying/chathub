import { BRANDING_NAME, CURRENT_VERSION, isDesktop } from '@lobechat/const';
import { NextRequest, NextResponse } from 'next/server';

import { getServerDB } from '@/database/server';
import { DrizzleMigrationModel } from '@/database/models/drizzleMigration';
import { DataExporterRepos } from '@/database/repositories/dataExporter';
import { createLambdaContext } from '@/libs/trpc/lambda/context';
import {
  CURRENT_DATA_BACKUP_FORMAT_VERSION,
  dataBackupV2Schema,
} from '@/types/export';

export const GET = async (request: NextRequest) => {
  const context = await createLambdaContext(request);
  if (!context.userId) {
    return NextResponse.json(
      { code: 'UNAUTHORIZED', message: 'Authentication is required.' },
      { status: 401 },
    );
  }

  try {
    const database = await getServerDB();
    const [data, schemaHash] = await Promise.all([
      new DataExporterRepos(database, context.userId).export(5),
      new DrizzleMigrationModel(database).getLatestMigrationHash(),
    ]);
    const exportedAt = new Date().toISOString();
    const backup = dataBackupV2Schema.parse({
      appVersion: CURRENT_VERSION,
      data,
      exportedAt,
      formatVersion: CURRENT_DATA_BACKUP_FORMAT_VERSION,
      mode: isDesktop ? 'pglite' : 'postgres',
      schemaHash,
      secretStrategy: 'deployment-keyed',
    });
    const timestamp = exportedAt.replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z');
    const filename = `${timestamp}_${BRANDING_NAME}-data-v${CURRENT_DATA_BACKUP_FORMAT_VERSION}.json`;

    return new Response(JSON.stringify(backup), {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Type': 'application/json; charset=utf-8',
        Pragma: 'no-cache',
      },
    });
  } catch (error) {
    console.error('[data-backup] export failed:', error);
    return NextResponse.json(
      { code: 'EXPORT_FAILED', message: 'Data export failed before a complete backup was created.' },
      { status: 500 },
    );
  }
};
