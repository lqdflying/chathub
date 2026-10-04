import { z } from 'zod';

import { SandboxApiName, type SandboxApiNameType } from '@/tools/sandbox/const';

// Models sometimes send numbers and booleans as strings, and null for an
// omitted argument.
const optionalNumber = z.preprocess(
  (value) => (value === null || value === '' ? undefined : value),
  z.coerce.number().finite().optional(),
);
const optionalBoolean = z.preprocess((value) => {
  if (value === null || value === '') return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}, z.boolean().optional());
const path = z.string().trim().min(1).max(4096);
const optionalPath = z.preprocess(
  (value) => (value === null || value === '' ? undefined : value),
  path.optional(),
);
const commandId = z.string().trim().min(1).max(256);
// The per-file byte cap is checked again after encoding.
const fileText = z.string().max(16 * 1024 * 1024);

export const sandboxToolSchemas = {
  [SandboxApiName.editFile]: z.object({
    newString: fileText,
    oldString: fileText.min(1),
    path,
    replaceAll: optionalBoolean,
  }),
  [SandboxApiName.exportFile]: z.object({
    paths: z.preprocess(
      (value) => (typeof value === 'string' ? [value] : value),
      z.array(path).min(1).max(50),
    ),
  }),
  [SandboxApiName.getCommandOutput]: z.object({
    commandId,
    cursor: optionalNumber,
  }),
  [SandboxApiName.listFiles]: z.object({
    depth: optionalNumber,
    path: optionalPath,
  }),
  [SandboxApiName.readFile]: z.object({
    limit: optionalNumber,
    offset: optionalNumber,
    path,
  }),
  [SandboxApiName.runCommand]: z.object({
    background: optionalBoolean,
    command: z.string().min(1).max(512_000),
    cwd: optionalPath,
    timeout: optionalNumber,
  }),
  [SandboxApiName.runPython]: z.object({
    code: z.string().max(512_000),
    packages: z.array(z.string().max(256)).max(50).nullish(),
    timeout: optionalNumber,
  }),
  [SandboxApiName.stopCommand]: z.object({ commandId }),
  [SandboxApiName.writeFile]: z.object({ content: fileText, path }),
} satisfies Record<SandboxApiNameType, z.ZodTypeAny>;

export type SandboxToolArgs = {
  [K in SandboxApiNameType]: z.infer<(typeof sandboxToolSchemas)[K]>;
};

export const isSandboxApiName = (apiName: string): apiName is SandboxApiNameType =>
  Object.prototype.hasOwnProperty.call(sandboxToolSchemas, apiName);
