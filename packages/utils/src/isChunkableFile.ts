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

const extensionOf = (name: string) =>
  name
    .toLowerCase()
    .split(/[./\\]/)
    .pop() || '';

/** Returns true only for formats handled by the Knowledge Base loaders. */
export const isChunkableFile = (name = '', fileType = ''): boolean => {
  const normalizedType = fileType.toLowerCase().split(';', 1)[0].trim();
  const extension = extensionOf(name || normalizedType);
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

export const chunkableFileExtensions = [...CHUNKABLE_EXTENSIONS].map(
  (extension) => `.${extension}`,
);
