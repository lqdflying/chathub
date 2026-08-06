# CLAUDE.md — ChatHub

Instructions for Claude Code working in this repository. General agent rules live in
`AGENTS.md`; authoritative workflow detail lives under `.cursor/rules/` (especially
`git-and-release.mdc` for the full release flow). This file adds what those docs do not
cover: how to operate from the **Claude Code cloud/remote environment**.

## Git workflow (ALL sessions — local *and* cloud)

Unlike the rest of this file, this section is **not** cloud-specific. The branch rule binds
every Claude Code session, local included; the `claude/*` naming below is the only
cloud-only part.

In a cloud session the designated `claude/*` branch is the working branch. **When already on
any non-`main` branch, keep committing successive rounds (fixes, features, docs) to that same
branch — do not create additional branches per fix/feature.** This deliberately avoids branch
chains; distinct commit messages separate the phases (aligned with `AGENTS.md`).
Create a new branch only when currently on `main` or when the user explicitly asks for an
isolation branch — **an open PR on the current branch is not a reason to fork**, and a new
branch always forks from the current HEAD, never from `main` while standing elsewhere. The
enumerated non-reasons are in **`.cursor/rules/git-and-release.mdc`** (*Before first code
edit*); read them before concluding a second branch is justified.

## Canary / testing image builds (cloud sessions)

Docker images are built **only by pushing a git tag** (`v*.*.*` or `v*.*.*-canary.*`) —
`.github/workflows/docker-release.yml` has no branch trigger and no `workflow_dispatch`.

**Cloud Claude Code sessions cannot push tags.** The session's git credential proxy scopes
pushes to the designated work branch; pushing any `refs/tags/*` fails with HTTP 403 (a
policy denial — do not retry or route around it). The GitHub MCP tools available in cloud
sessions cannot create tags or releases either.

**Correct division of labor** (verified working):

1. Claude finishes and verifies the work, commits, and pushes the **branch**.
2. Claude computes the correct next tag per `.cursor/rules/git-and-release.mdc`
   (canary = prerelease of the **next unreleased** version; check existing tags with
   `git ls-remote --tags origin` — the clone is shallow and fetches no tags, so local
   `git tag -l` is always empty) and **provides the commands for the user to run
   locally**, pinned to the exact commit:

   ```bash
   git fetch origin <branch>
   git tag vX.Y.Z-canary.N <commit-sha>
   git push origin vX.Y.Z-canary.N
   ```

3. The **user runs those commands on their local machine** (or creates a GitHub Release
   with that tag/target). Claude must not claim the build was triggered until the tag is
   visible on origin.
4. Claude watches for the tag (poll `git ls-remote --tags origin` via a background
   monitor — never foreground sleep), then tracks the workflow run with the GitHub MCP
   Actions tools (`gh` CLI is **not** available in cloud sessions) and reports the result.
   `actions_list` responses are huge — extract fields from the saved result file instead
   of reading them raw.

Build facts: runs take ~16–18 minutes; a canary tag pushes
`docker.io/lqdflying/chathub:X.Y.Z-canary.N` and never touches `:latest`; the tag is baked
in via `NEXT_PUBLIC_APP_TAG` so the in-app About page shows the canary version; do **not**
bump `package.json` for canaries. A failed build cannot be re-run manually — fix, then
delete the bad tag and have the user push the next `N`. Docs-only commits never get a tag.

## GitHub Wiki updates — detect, do not assume

The wiki (`lqdflying/chathub.wiki`) is the local `wiki/` clone on branch `master`; see
`AGENTS.md` / `.cursor/rules/documentation-policy.mdc`. **Default: edit, commit and push
it directly.** The patch handoff below is a cloud-only fallback, not the normal path —
using it in a local session wastes the user's time on a manual `git am` they never needed.

**Decide by testing, never by guessing which environment this is:**

```bash
git -C wiki branch -avv              # present, a real clone, on master?
git -C wiki push --dry-run origin master
```

The dry run is the whole decision, and it changes nothing. If it succeeds, credentials
work — **push for real.** Do not produce a patch, do not ask the user to run anything, and
do not reason about "cloud vs local" from anything other than this result.

- **Dry run succeeds** (typical local session, SSH remote): commit and push the wiki as
  part of completing the work. No separate approval is needed for the **wiki** — the user
  has standing permission for it. This does **not** extend to the main repository, whose
  pushes, tags and releases still require an explicit in-turn instruction.
- **`wiki/` is absent**: report that and stop. Never clone it implicitly.
- **Dry run is denied** (HTTP 403 — a cloud session, whose credentials are scoped to the
  main repo): fall back to the patch handoff, mirroring the canary-tag division of labor.

### Cloud fallback: patch handoff

1. Commit the wiki change in the `wiki/` clone, then generate a portable patch — batching
   several commits with `-N` or a range when needed — and give the user the file:

   ```bash
   git -C wiki format-patch -1 --stdout > wiki-updates.patch
   ```

2. The **user applies and pushes from their machine** (full SSH access):

   ```bash
   cd path/to/chathub.wiki
   git am /path/to/wiki-updates.patch
   git push
   ```

   They can inspect it first with `git am --show-current-patch < wiki-updates.patch`.

`git format-patch` + `git am` preserves author, date and message, so the wiki history looks
the same as a direct push, with no credential sharing. Delete the patch file once the push
lands — by either route — so a stale patch cannot be applied twice.

## Cloud environment quirks

- **Dependency install**: `cdn.sheetjs.com` is blocked by the egress proxy, so a plain
  `pnpm install` fails on `packages/file-loaders`' `xlsx` dependency. Workaround: add a
  **local-only** override `"pnpm": { "overrides": { "xlsx": "npm:xlsx@0.18.5" } }` to
  `package.json`, install, then **revert `package.json` before committing** — never commit
  the override.
- **Tests**: run targeted suites with `npx vitest run <paths>`. Database model and
  repository tests use the PostgreSQL test configuration and require `DATABASE_TEST_URL`.
- **Type-check**: `npm run type-check` currently reports a large number of **pre-existing**
  errors on `main` (~248 in the cloud sandbox). The acceptance bar is **no new errors**:
  capture a baseline (stash → run → restore) and diff by file+error-code; note that
  TS2589 relocates between files and union orderings in messages are unstable.
- **i18n**: edit `src/locales/default/<ns>.ts` plus `locales/zh-CN` and `locales/en-US`
  JSON by hand only; never run `pnpm i18n` (CI fills the other locales).
