# Agent instructions (ChatHub)

This file is for automated agents and assistants working in this repository. Authoritative detail lives under **`.cursor/rules/`**.

## Git and branches (required)

- For every **bugfix** or **feature**: **do not** implement on **`main`**. If currently on `main`, create a **`fix/<short-slug>`** or **`feat/<short-slug>`** branch before editing.
- If already on a non-`main` branch, continue there by default unless the user asks for a fresh branch or the current branch is clearly unrelated.
- **Never** `git commit`, `git tag`, or `git push` without an **explicit in-turn** user instruction (same turn).

Full workflow (stash, canary/GA tags, Docker release, recovery): **`.cursor/rules/git-and-release.mdc`**.

## Planning (Plan mode)

When writing or updating an **implementation plan** (e.g. Cursor Plan mode / `CreatePlan`), include a short **Git workflow** subsection aligned with the rules above (branch first only when currently on `main`, no edits on `main`, no commit/push without explicit approval).

## Project context

Overview, stack, naming, wiki workflow: **`.cursor/rules/project.mdc`**. Per-model API toggles (extendParams): **`.cursor/rules/provider-model-options.mdc`**. Commands and test constraints: **`.cursor/rules/commands.mdc`**. MCP management UI patterns: **`.cursor/rules/mcp-management-ui.mdc`**.

## OpenWiki

This repository has documentation located in the repo-local `openwiki/` directory.

Start here:
- [OpenWiki quickstart](openwiki/quickstart.md)

OpenWiki includes repository overview, architecture notes, workflows, domain concepts, operations, integrations, testing guidance, and source maps.

When working in this repository, read the OpenWiki quickstart first, then follow its links to the relevant architecture, workflow, domain, operation, and testing notes.
