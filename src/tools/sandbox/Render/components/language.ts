const EXTENSION_LANGUAGES: Record<string, string> = {
  bash: 'bash',
  c: 'c',
  cjs: 'javascript',
  cpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  csv: 'text',
  dockerfile: 'dockerfile',
  go: 'go',
  h: 'c',
  html: 'html',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsx: 'jsx',
  kt: 'kotlin',
  md: 'markdown',
  mjs: 'javascript',
  php: 'php',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  scss: 'scss',
  sh: 'bash',
  sql: 'sql',
  swift: 'swift',
  toml: 'toml',
  ts: 'typescript',
  tsx: 'tsx',
  vue: 'vue',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'bash',
};

/** Highlighter language for a file path, `text` when unknown. */
export const languageForPath = (path?: string) => {
  const name = (path ?? '').split('/').pop()?.toLowerCase() ?? '';
  if (name === 'dockerfile') return 'dockerfile';
  const extension = name.includes('.') ? name.split('.').pop()! : '';
  return EXTENSION_LANGUAGES[extension] ?? 'text';
};
