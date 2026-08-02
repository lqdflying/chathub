# Agent Skills

ChatHub skills are globally installed `SKILL.md` instruction bundles. Installed
skills are available from the topic composer, while instruction bodies are
resolved only for the skills checked in that conversation. This keeps normal
prompts small and makes the composer the sole activation authority.

## Storage and service boundary

Installed skills are stored in the `userInstalledSkills` table. The table keeps
the identifier, display metadata, source, source type, and SHA-256 content hash
alongside the full instruction body. `SkillModel.query()` deliberately omits
the body; `findById()` and `resolveSkills()` are the full-content boundary.

The app-facing service is under `src/services/skill/`. The server router in
`src/server/routers/lambda/skill.ts` provides metadata listing, full lookup,
install, edit, uninstall, activation resolution, and optional registry search.
Edits keep the identifier and source metadata immutable, validate a canonical
`SKILL.md`, and update the description, instruction body, content hash, and
timestamp for the account-owned record.
Install-by-URL is HTTPS-only, rejects URL credentials, follows no redirects,
uses SSRF-safe fetching, and enforces a 128 KiB body limit. GitHub repository,
blob, and tree URLs are normalized to raw content before fetching.

Local `.skill` imports are handled in the browser by
`src/services/skill/archive.ts`. The archive is decompressed with `fflate`, but
only `SKILL.md` is materialized. It may be at the archive root or inside one
top-level folder; for the folder layout, the folder and frontmatter names must
match. Other files may appear elsewhere in the archive and are counted as
skipped resources rather than rejected. Absolute paths, parent traversal,
backslashes, invalid UTF-8, multiple skill documents, archives over 30 MiB, and
archives with more than 1024 files are rejected. The `SKILL.md` body retains
the same 128 KiB limit as URL installs.

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
and removes that identifier from every legacy `agents.skills` array owned by
the same user. Those arrays remain for data compatibility but no longer gate
the UI or runtime. The skill store also prunes pending composer selections.

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
`enableSkills: false` and hides the global Settings entry and ChatInput picker.
This is a presentation gate: it does not delete installed records or rewrite
legacy assistant skill IDs.

The Skills management page has separate desktop and mobile layouts. Mobile
Settings includes a feature-gated Skills destination; selecting a list item
opens its details in a modal instead of retaining the desktop split panel. The
install dialog defaults to local-file upload and also retains URL installation.
Both layouts provide an editor for description and Markdown instructions. The
identifier is read-only, source provenance is preserved, and the content hash
is internal metadata rather than an end-user detail.

## Activation flow

Every globally installed skill appears in the Sparkles picker in desktop and
mobile composers. Checkbox state is keyed by session, topic, and thread. It
persists across sends and in-app navigation for the current browser session,
until the user unchecks it. Reloading the app or changing accounts resets the
in-memory state, and uninstalling a skill prunes it from every selection.

Skill names are not editor slash commands. Text such as `/reviewer` is sent
byte-for-byte as normal user content, while unrelated editor slash actions such
as table insertion remain available.

Send hooks intersect checked IDs with the current globally installed metadata
and store those IDs in latest-turn message metadata. The chat service repeats
the account-scoped installed check, deduplicates the IDs, applies the existing
16-skill limit, and calls `resolveSkills()` only for that set.
`SkillInstructionsProvider` injects the selected instruction bodies in
`<activated_skills>`; unchecked skill names and descriptions are not disclosed
through an `<available_skills>` block.

The hidden `lobe-skill-loader` is no longer offered to models and new loader
calls are not executed. The manifest, compact renderer, and request sanitizer
remain only so historical loader rows render safely and any legacy persisted
instruction body is removed before context engineering. Loader-result metadata
cannot activate a skill.

Group turns use the same conversation-scoped global selection and message
metadata contract. Every participating member receives the explicitly selected
installed skills; member-level legacy `skills` arrays do not filter them.

## Change points and tests

When changing this feature, review the parser, registry adapter, server router,
archive parser, `src/services/chat/index.ts`, the context-engine provider, the
desktop and mobile ChatInput pickers/send hooks, and the global skill store
together. Focused coverage lives in
`src/services/skill/*.test.ts`,
`packages/context-engine/src/providers/__tests__/SkillInstructionsProvider.test.ts`,
and `packages/database/src/models/__tests__/skill.test.ts`.
