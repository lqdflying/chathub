# Agent instructions (ChatHub)

This file is for automated agents and assistants working in this repository. Authoritative detail lives under **`.cursor/rules/`**.

## Git and branches (required)

**One round done → commit locally, immediately — no exceptions.** Whenever a round of coding (bugfix, feature, or review-fix) is complete and verified, commit it locally right then in every affected repository. Never leave completed work uncommitted/unstashed to "combine later" or wait for the next prompt — the next prompt may never come, and uncommitted work is stale or lost work.

- For every **bugfix** or **feature**: **do not** implement on **`main`**. If currently on `main`, create a **`fix/<short-slug>`** or **`feat/<short-slug>`** branch before editing.
- If already on a non-`main` branch, continue there by default even when the troubleshooting target changes before GA. Do not create another branch just because the next fix/feature touches a different area, is larger in scope, or because the current branch has an **open pull request** that an unrelated commit would "pollute" — that trade-off belongs to the user, not the agent. Use distinct commit messages to separate phases unless the user explicitly asks for a fresh/isolation branch. A new branch **always forks from the current HEAD**, never from `main` while standing on a work branch. Full criteria: **`.cursor/rules/git-and-release.mdc`** (*Before first code edit*).
- After each completed and verified bugfix or feature, create local commits automatically in **every affected Git repository**. If both the main repository and the separate `wiki/` repository changed, commit each repository locally with only its relevant files.
- Treat every completed implementation or review-fix pass as a separate round. Each verified round must create a new local commit on top of the previous round's commit, including fixes based on review. Never amend a completed round or leave it uncommitted to combine with later work.
- **Never** `git push`, create/push a tag, trigger a remote build, or perform GA/release actions without an **explicit in-turn** user instruction.
- Run the pre-commit inspection **once**, batching `git status`, `git diff`, and `git log` into a single message per affected repository. After a read-only check returns output, move forward (stage, commit, verify) or stop and report — never re-run it. Identical output from a repeated inspection with no edits in between means the agent is looping, not verifying.
- The completion order is mandatory: **verify → one-time preflight → local commit(s) → post-commit `git status` + `git log -1` → final response**. Never report `complete`, `fixed`, `passed with no follow-up`, or `no additional action needed` while any file from the completed round remains uncommitted. If committing is blocked, report the blocker instead of claiming completion.

Full workflow (stash, canary/GA tags, Docker release, recovery): **`.cursor/rules/git-and-release.mdc`**.

## Planning (Plan mode)

When writing or updating an **implementation plan** (e.g. Cursor Plan mode / `CreatePlan`), include:

- a short **Git workflow** subsection aligned with the rules above (branch first only when currently on `main`, automatic local commits in every affected repository after completion, no push/tag/release without explicit approval)
- a **Documentation impact** subsection following **`.cursor/rules/documentation-policy.mdc`**

## Project context

Overview, stack, naming, wiki workflow: **`.cursor/rules/project.mdc`**. Per-model API toggles (extendParams): **`.cursor/rules/provider-model-options.mdc`**. Commands and test constraints: **`.cursor/rules/commands.mdc`**. MCP management UI patterns: **`.cursor/rules/mcp-management-ui.mdc`**.

Every non-trivial change must follow **`.cursor/rules/documentation-policy.mdc`**.
User-facing workflows, settings, controls, deployment, configuration, diagnostics,
and troubleshooting changes require a GitHub Wiki evaluation and update when
applicable. Internal architecture and maintainer behavior require OpenWiki when
applicable; changes affecting both audiences update both surfaces. The GitHub
Wiki clone (`wiki/`) is a separate repository on branch `master`; verify it with
`git -C wiki branch -avv` before edits and preserve unrelated wiki work. If
`wiki/` is absent, note that it was unavailable rather than cloning it implicitly.

## OpenWiki

This repository has documentation located in the repo-local `openwiki/` directory.

Start here:
- [OpenWiki quickstart](openwiki/quickstart.md)

OpenWiki includes repository overview, architecture notes, workflows, domain concepts, operations, integrations, testing guidance, and source maps.

For non-trivial, unfamiliar, architectural, workflow, integration, or provider/runtime work, read the OpenWiki quickstart first, then follow its links to the relevant architecture, workflow, domain, operation, and testing notes.
