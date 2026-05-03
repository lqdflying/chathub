# Agent instructions (LobeHub)

This file is for automated agents and assistants working in this repository. Authoritative detail lives under **`.cursor/rules/`**.

## Git and branches (required)

- For every **bugfix** or **feature**: sync **`main`** when practical, then **`git checkout -b`** a **new** **`fix/<short-slug>`** or **`feat/<short-slug>`** branch. **Do not** implement on **`main`**.
- Do not stack unrelated work on an existing open topic branch unless the user explicitly asks to continue that branch.
- **Never** `git commit`, `git tag`, or `git push` without an **explicit in-turn** user instruction (same turn).

Full workflow (stash, canary/GA tags, Docker release, recovery): **`.cursor/rules/git-and-release.mdc`**.

## Planning (Plan mode)

When writing or updating an **implementation plan** (e.g. Cursor Plan mode / `CreatePlan`), include a short **Git workflow** subsection aligned with the rules above (new branch off synced `main`, no edits on `main`, no commit/push without explicit approval).

## Project context

Overview, stack, naming, wiki workflow: **`.cursor/rules/project.mdc`**. Per-model API toggles (extendParams): **`.cursor/rules/provider-model-options.mdc`**. Commands and test constraints: **`.cursor/rules/commands.mdc`**. MCP management UI patterns: **`.cursor/rules/mcp-management-ui.mdc`**.
