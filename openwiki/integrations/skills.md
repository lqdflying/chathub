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

## Activation flow

An assistant opts into installed skills from its Skills settings tab. For a
turn, the user can select skills with the Sparkles picker or type one or more
leading slash commands, for example `/summarizer /reviewer Please inspect this`.
Recognized commands are removed from the prompt and their identifiers are
stored in message metadata. Unknown slash commands remain normal text and
produce a warning.

The chat service first reads enabled metadata, intersects requested IDs with
the assistant's enabled IDs, and calls `resolveSkills()` only for that
intersection. `SkillInstructionsProvider` then injects an
`<available_skills>` metadata block and an `<activated_skills>` block containing
the selected instruction bodies.

The hidden `lobe-skill-loader` builtin gives the model a dynamic path: when
skills are enabled, the model can call `load_skill` with an identifier. The
tool verifies that the identifier is enabled for the current assistant and
loads exactly that skill body for the continuation. It is not shown in the
normal tool picker.

Group turns use the same message-metadata contract. Slash commands and picker
selection are intersected with the union of the participating members' enabled
skills; each member's runtime prompt receives only its own enabled activation.

## Change points and tests

When changing this feature, review the parser, registry adapter, server router,
`src/services/chat/index.ts`, the context-engine provider, the ChatInput picker,
and the assistant/settings stores together. Focused coverage lives in
`src/services/skill/*.test.ts`,
`packages/context-engine/src/providers/__tests__/SkillInstructionsProvider.test.ts`,
and `packages/database/src/models/__tests__/skill.test.ts`.
