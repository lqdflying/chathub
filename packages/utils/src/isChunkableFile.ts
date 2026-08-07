const CHUNKABLE_EXTENSIONS = new Set([
  'cpp',
  'csv',
  'css',
  'docx',
  'epub',
  'go',
  'html',
  'java',
  'js',
  'json',
  'jsx',
  'latex',
  'less',
  'log',
  'markdown',
  'md',
  'mdx',
  'mjs',
  'patch',
  'pdf',
  'php',
  'pptx',
  'proto',
  'py',
  'python',
  'rs',
  'rst',
  'ruby',
  'rust',
  'scala',
  'sh',
  'sol',
  'sql',
  'swift',
  'tex',
  'ts',
  'tsx',
  'txt',
  'toml',
  'yaml',
  'yml',
]);

const CHUNKABLE_MIME_TYPES = new Set([
  'application/epub+zip',
  'application/json',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/x-tex',
  'application/xml',
  'application/yaml',
  'text/csv',
  'text/markdown',
  'text/plain',
  'text/x-markdown',
  'text/x-tex',
  'text/xml',
]);

const UNSUPPORTED_EXTENSIONS = new Set([
  'db',
  'doc',
  'docm',
  'sqlite',
  'sqlite3',
  'xls',
  'xlsx',
  'zip',
]);

/**
 * Formats the MarkItDown sidecar converts to Markdown that the built-in loaders
 * cannot read — spreadsheets, Outlook mail, notebooks, archives, feeds, images
 * and audio.
 *
 * Mirrors the format table at
 * https://github.com/lqdflying/chathub/wiki/MarkItDown-Sidecar, which is the
 * authority: if the sidecar's converter set changes, this set must follow, or
 * the upload picker offers files the deployment cannot ingest.
 *
 * Legacy `.doc`/`.docm` stay out: MarkItDown has no converter for them either.
 */
const MARKITDOWN_EXTENSIONS = new Set([
  'atom',
  'htm',
  'ipynb',
  'jpeg',
  'jpg',
  'jsonl',
  'm4a',
  'mp3',
  'mp4',
  'msg',
  'png',
  'rss',
  'rtf',
  'text',
  'wav',
  'xls',
  'xlsx',
  'xml',
  'zip',
]);

const MARKITDOWN_MIME_TYPES = new Set([
  'application/atom+xml',
  'application/csv',
  'application/excel',
  'application/rss+xml',
  'application/rtf',
  'application/vnd.ms-excel',
  'application/vnd.ms-outlook',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/x-m4a',
  'audio/x-wav',
  'image/jpeg',
  'image/png',
  'text/rtf',
  'video/mp4',
]);

export interface ChunkableFileCapabilities {
  /** A MarkItDown conversion sidecar is configured for this deployment. */
  markitdown: boolean;
}

/**
 * Which converters the deployment can reach. Resolved from the environment on
 * the server; the client hydrates it from `GlobalServerConfig` so the upload
 * picker offers exactly the formats the server can actually ingest.
 */
const capabilities: ChunkableFileCapabilities = {
  markitdown: typeof process !== 'undefined' && !!process.env?.MARKITDOWN_SERVICE_URL,
};

export const setChunkableFileCapabilities = (next: Partial<ChunkableFileCapabilities>) => {
  Object.assign(capabilities, next);
};

export const getChunkableFileCapabilities = (): ChunkableFileCapabilities => ({ ...capabilities });

/**
 * Office/MSDoc formats that the in-app file preview delegates to Microsoft
 * Office Online, which must fetch the file URL publicly. On a private /
 * self-hosted host that fetch fails, so these types cannot be previewed
 * locally and should fall back to the converted-chunk content viewer.
 */
const OFFICE_PREVIEW_EXTENSIONS = new Set(['doc', 'docx', 'odt', 'ppt', 'pptx', 'xls', 'xlsx']);

/** True for Office/MSDoc types whose preview requires the external Office Online service. */
export const isOfficePreviewFile = (name = '', fileType = ''): boolean => {
  const extension = extensionOf(name || fileType.toLowerCase().split(';', 1)[0].trim());
  return OFFICE_PREVIEW_EXTENSIONS.has(extension);
};

/**
 * True when the file can be converted by the MarkItDown sidecar. MarkItDown
 * reads its own extended set (spreadsheets, images, audio, archives — the very
 * formats the built-in loaders reject) plus the standard Office/code/text
 * formats. Only legacy `.doc`/`.docm` and database/binary types are excluded.
 */
export const isMarkItDownConvertibleFile = (name = '', fileType = ''): boolean => {
  if (!capabilities.markitdown) return false;
  const normalizedType = fileType.toLowerCase().split(';', 1)[0].trim();
  const extension = extensionOf(name || normalizedType);

  // MarkItDown converts these despite the built-in loaders rejecting them, so
  // check its sets before the unsupported/media rejections (mirrors isChunkableFile).
  if (MARKITDOWN_EXTENSIONS.has(extension) || MARKITDOWN_MIME_TYPES.has(normalizedType)) {
    return true;
  }

  if (UNSUPPORTED_EXTENSIONS.has(extension)) return false;
  if (
    normalizedType.startsWith('image/') ||
    normalizedType.startsWith('audio/') ||
    normalizedType.startsWith('video/')
  ) {
    return false;
  }

  return (
    CHUNKABLE_EXTENSIONS.has(extension) ||
    CHUNKABLE_MIME_TYPES.has(normalizedType) ||
    normalizedType.startsWith('text/')
  );
};

const extensionOf = (name: string) =>
  name
    .toLowerCase()
    .split(/[./\\]/)
    .pop() || '';

/** Returns true only for formats handled by the Knowledge Base loaders. */
export const isChunkableFile = (name = '', fileType = ''): boolean => {
  const normalizedType = fileType.toLowerCase().split(';', 1)[0].trim();
  const extension = extensionOf(name || normalizedType);
  const withMarkItDown = capabilities.markitdown;

  if (
    withMarkItDown && // Checked before the media-prefix and unsupported-extension rejections
    // below, which exist only because the built-in loaders cannot read these.
    (MARKITDOWN_EXTENSIONS.has(extension) || MARKITDOWN_MIME_TYPES.has(normalizedType))
  ) {
    return true;
  }

  if (UNSUPPORTED_EXTENSIONS.has(extension)) return false;
  if (
    normalizedType.startsWith('image/') ||
    normalizedType.startsWith('audio/') ||
    normalizedType.startsWith('video/')
  ) {
    return false;
  }
  if (CHUNKABLE_MIME_TYPES.has(normalizedType) || normalizedType.startsWith('text/')) return true;

  return CHUNKABLE_EXTENSIONS.has(extension);
};

const toDotted = (extensions: Iterable<string>) => [...extensions].map((ext) => `.${ext}`);

/**
 * Extensions to offer in the Knowledge Base upload picker. Depends on the
 * deployment's converters, so call it at render time rather than caching it.
 */
export const getChunkableFileExtensions = (): string[] =>
  capabilities.markitdown
    ? toDotted([...CHUNKABLE_EXTENSIONS, ...MARKITDOWN_EXTENSIONS])
    : toDotted(CHUNKABLE_EXTENSIONS);

/** @deprecated prefer {@link getChunkableFileExtensions}, which honours the deployment's converters. */
export const chunkableFileExtensions = toDotted(CHUNKABLE_EXTENSIONS);
