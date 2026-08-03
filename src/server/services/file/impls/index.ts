import { S3StaticFileImpl } from './s3';
import { FileServiceImpl } from './type';

/**
 * Create the server-backed file service.
 */
export const createFileServiceModule = (): FileServiceImpl => new S3StaticFileImpl();

export type { FileServiceImpl } from './type';
