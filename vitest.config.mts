import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

// Mirrors tsconfig.json paths — array aliases resolve in order (first match wins).
// Per tsconfig: @/const/* -> [packages/const/src/*, src/const/*]
//               @/utils/* -> [packages/utils/src/*, src/utils/*]
const ALIASES = [
  // @/const: most files are in packages/const/src, but locale.ts is only in src/const
  { find: /^@\/const\/locale(.*)$/, replacement: resolve(__dirname, 'src/const/locale$1') },
  { find: /^@\/const(.*)$/, replacement: resolve(__dirname, 'packages/const/src$1') },
  // @/utils: most files are in packages/utils/src, but these are only in src/utils
  // These specific aliases MUST come before the broad @/utils → packages/utils/src catch-all.
  { find: /^@\/utils\/server(.*)$/, replacement: resolve(__dirname, 'src/utils/server$1') },
  // Individual src-only utils (not in packages/utils/src)
  { find: /^@\/utils\/client\/switchLang(.*)$/, replacement: resolve(__dirname, 'src/utils/client/switchLang$1') },
  { find: /^@\/utils\/errorResponse(.*)$/, replacement: resolve(__dirname, 'src/utils/errorResponse$1') },
  { find: /^@\/utils\/locale(.*)$/, replacement: resolve(__dirname, 'src/utils/locale$1') },
  { find: /^@\/utils\/unzipFile(.*)$/, replacement: resolve(__dirname, 'src/utils/unzipFile$1') },
  { find: /^@\/utils(.*)$/, replacement: resolve(__dirname, 'packages/utils/src$1') },
  // package-scoped aliases
  { find: /^@\/database(.*)$/, replacement: resolve(__dirname, 'packages/database/src$1') },
  { find: /^@\/types(.*)$/, replacement: resolve(__dirname, 'packages/types/src$1') },
  // catch-all: everything else under @/ maps to src/
  { find: /^@\/(.*)$/, replacement: resolve(__dirname, 'src/$1') },
];

export default defineConfig({
  test: {
    alias: ALIASES,
    environment: 'happy-dom',
    globals: true,
  },
});
