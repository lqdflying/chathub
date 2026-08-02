# Agent Skills

ChatHub skills are installable `SKILL.md` instruction bundles. Their metadata is
available to the picker and settings UI, while the instruction body is loaded
only for an explicitly activated skill. This keeps normal prompts small and
prevents an installed skill from silently changing every request.

## Storage and service boundary

Installed skills are stored in the `userInstalledSkills` table. The table keeps
the identifier, display metadata, source, source type, and SHA-256 content hash
alongside the full instruction body. `SkillModel.query()` deliberately omits
the body; `findById()` and `resolveSkills()` are the full-content boundary.

The app-facing service is under `src/services/skill/`. The server router in
`src/server/routers/lambda/skill.ts` provides metadata listing, full lookup,
install, uninstall, activation resolution, and optional registry search.
Install-by-URL is HTTPS-only, rejects URL credentials, follows no redirects,
uses SSRF-safe fetching, and enforces a 128 KiB body limit. GitHub repository,
blob, and tree URLs are normalized to raw content before fetching.

Local `.skill` imports are handled in the browser by
`src/services/skill/archive.ts`. The archive is decompressed with `fflate`, but
only `SKILL.md` is materialized. Accepted layouts contain either a root-level
`SKILL.md` or one top-level folder containing `SKILL.md`; for the folder layout,
the folder and frontmatter names must match. Absolute paths, parent traversal,
backslashes, invalid UTF-8, multiple skill documents, archives over 30 MiB, and
archives with more than 1024 files are rejected. The `SKILL.md` body retains the
same 128 KiB limit as URL installs.

Packaged scripts, references, assets, and other resource files are counted but
not extracted or persisted. The settings UI warns after installation when any
such resources were skipped. The persisted source type is `file`, the original
archive filename is kept as `sourceRef`, and local imports cannot carry a
remote source URL. This scope supports instruction-only Claude `.skill`
packages without exposing archive paths or executable payloads to the server.

Installed metadata is owned by the account-scoped SWR key
`['installed-skills', scope]`. Settings and chat consumers mount the same
`useFetchSkills` subscription, while install and uninstall actions revalidate
that key. The hook's success handler is the single point that updates the skill
store and removes stale pending selections.

The router maps invalid documents, sources, registry identity mismatches, and
non-success source responses to `BAD_REQUEST`; bounded-fetch overflow is
`PAYLOAD_TOO_LARGE`. A second identifier with the same content hash is reported
as `CONFLICT`. Registry configuration and malformed upstream registry JSON
remain internal server faults.

Uninstall is a single database transaction: it deletes the installed record
and removes that identifier from every `agents.skills` array owned by the same
user. The skill store also prunes loaded agent and group-member caches so the
current tab reflects the database change immediately.

## Skill format and sources

The source document must be Markdown with YAML frontmatter containing:

```md
---
name: concise-skill-name
description: One sentence describing when to use it.
---

Instructions for the model...
```

The name is a lowercase identifier (`a-z`, digits, and single hyphens), and
the description and body are required. The raw source is hashed after parsing
so reinstalling changed content is observable.

The optional `SKILLS_INDEX_URL` environment variable points to a JSON registry.
The registry may be an array or an object containing `skills`, `items`, or
`results`; each entry supplies an identifier, description, and HTTPS source URL
(or a GitHub repository/path/ref tuple). Registry search returns metadata only.
When a registry result is installed, its identifier is carried as the expected
identity; installation fails if the downloaded frontmatter `name` differs.

Skills UI is enabled by default. `FEATURE_FLAGS="-skills"` maps to
`enableSkills: false` and hides the global Settings entry, assistant Skills tab,
ChatInput picker, and editor skill slash items. This is a presentation gate: it
does not delete installed records or rewrite saved assistant skill IDs.

The Skills management page has separate desktop and mobile layouts. Mobile
Settings includes a feature-gated Skills destination; selecting a list item
opens its details in a modal instead of retaining the desktop split panel. The
install dialog defaults to local-file upload and also retains URL installation.

## Activation flow

An assistant opts into installed skills from its Skills settings tab. For a
turn, the user can select skills with the Sparkles picker or type one or more
leading slash commands, for example `/summarizer /reviewer Please inspect this`.
Recognized commands are removed from the prompt and their identifiers are
stored in message metadata. Unknown slash commands remain normal text and
produce a warning.

Choosing a skill from the editor slash menu toggles the same pending selection
shown in the Sparkles picker; it does not rewrite or round-trip the editor
document. A manually typed known command with no remaining text and no
attachment is a no-op, preserving the draft and pending selections. Input is
returned byte-for-byte when no known command is consumed, including leading
whitespace.

Picker state is keyed by session, topic, and thread. A pending choice therefore
stays with its draft conversation and only that conversation's choices are
cleared after a send.

The chat service first reads enabled metadata, intersects requested IDs with
the assistant's enabled IDs, and calls `resolveSkills()` only for that
intersection. `SkillInstructionsProvider` then injects an
`<available_skills>` metadata block and an `<activated_skills>` block containing
the selected instruction bodies. Activation candidates use the first non-empty
list from runtime options, request parameters, then latest-turn message
metadata. After deduplication and enabled-skill filtering, at most the first 16
identifiers are resolved. Activation lookup is anchored to the latest user
message and tool results that follow it; metadata from an older user turn cannot
reactivate a skill on a later request.

The hidden `lobe-skill-loader` builtin gives the model a dynamic path: when
skills are enabled, the model can call `load_skill` with an identifier. The
tool verifies that the identifier is enabled for the current assistant and
loads exactly that skill body for the continuation. The stored tool result is a
compact marker containing identity, hash, and status plus activation metadata;
the instruction body is resolved again for the continuation instead of being
written into chat history. Legacy loader results are stripped to the same
compact shape before context engineering. The builtin is not shown in the
normal tool picker. Its chat row uses a localized title and renders the compact
marker as a short loaded confirmation.

Group turns use the same message-metadata contract. Slash commands and picker
selection are intersected with the union of the participating members' enabled
skills; each member's runtime prompt receives only its own enabled activation.
The Sparkles picker is present in the active V1 mobile composer and the regular
desktop group composer. The mobile send hook uses the same conversation-keyed
selection, slash parsing, unknown-command warning, and group metadata contract
as the desktop editor. A command-only mobile draft remains untouched unless a
file is attached.

## Change points and tests

When changing this feature, review the parser, registry adapter, server router,
archive parser, `src/services/chat/index.ts`, the context-engine provider, the
desktop and mobile ChatInput pickers/send hooks, and the assistant/settings
stores together. Focused coverage lives in
`src/services/skill/*.test.ts`,
`packages/context-engine/src/providers/__tests__/SkillInstructionsProvider.test.ts`,
and `packages/database/src/models/__tests__/skill.test.ts`.
