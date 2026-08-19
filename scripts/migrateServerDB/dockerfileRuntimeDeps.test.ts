// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const dockerfile = readFileSync(resolve(process.cwd(), 'Dockerfile'), 'utf8');

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const writeFakeGraphileWorker = (root: string) => {
  const pkgDir = join(root, 'node_modules', 'graphile-worker');
  mkdirSync(join(pkgDir, 'dist'), { recursive: true });
  writeFileSync(
    join(pkgDir, 'package.json'),
    JSON.stringify({ main: 'dist/index.js', name: 'graphile-worker' }),
  );
  writeFileSync(join(pkgDir, 'dist', 'index.js'), "require('tslib');\n");
};

const requireGraphileWorker = (cwd: string) => {
  const env = { ...process.env };
  delete env.NODE_PATH;
  return spawnSync(process.execPath, ['-e', "require('graphile-worker')"], {
    cwd,
    encoding: 'utf8',
    env,
  });
};

describe('Dockerfile Graphile Worker runtime overlay', () => {
  it('installs /deps with npm so Docker COPY keeps tslib next to graphile-worker', () => {
    expect(dockerfile).toContain(
      'npm install pg@^8.16.3 drizzle-orm@^0.44.6 graphile-worker@0.17.3 --omit=dev',
    );
    expect(dockerfile).toContain('COPY --from=builder /deps/node_modules /tmp/deps-node-modules');
    expect(dockerfile).toContain('if [ -L "$dest" ]; then rm -f "$dest"; fi;');
    expect(dockerfile).toContain('cp -a /tmp/deps-node-modules/. /app/node_modules/');
    expect(dockerfile).toContain("require('/app/node_modules/graphile-worker')");
    expect(dockerfile).not.toContain(
      'COPY --from=builder /deps/node_modules/ /app/node_modules/',
    );
    expect(dockerfile).not.toContain(
      'COPY --from=builder /deps/node_modules/graphile-worker /app/node_modules/graphile-worker',
    );
  });

  it('cannot resolve tslib from a package-only graphile-worker tree', () => {
    const root = mkdtempSync(join(tmpdir(), 'chathub-gw-'));
    tempDirs.push(root);
    writeFakeGraphileWorker(root);

    const result = requireGraphileWorker(root);
    expect(result.status).not.toBe(0);
    expect(`${result.stderr}${result.stdout}`).toMatch(/Cannot find module 'tslib'/);
  });

  it('resolves tslib when it is hoisted beside graphile-worker', () => {
    const root = mkdtempSync(join(tmpdir(), 'chathub-gw-'));
    tempDirs.push(root);
    writeFakeGraphileWorker(root);
    mkdirSync(join(root, 'node_modules', 'tslib'), { recursive: true });
    writeFileSync(
      join(root, 'node_modules', 'tslib', 'package.json'),
      JSON.stringify({ main: 'tslib.js', name: 'tslib' }),
    );
    writeFileSync(
      join(root, 'node_modules', 'tslib', 'tslib.js'),
      'module.exports = { ok: true };\n',
    );

    const result = requireGraphileWorker(root);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
});
