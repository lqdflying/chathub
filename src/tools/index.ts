import { LobeBuiltinTool } from '@lobechat/types';

import { ArtifactsManifest } from './artifacts';
import { DalleManifest } from './dalle';
import { MemoryManifest } from './memory';
import { LEGACY_BUILTIN_TOOL_ALIASES, SandboxIdentifier, isSandboxToolIdentifier } from './sandbox';
import { SkillLoaderManifest } from './skills';
import { WebBrowsingManifest } from './web-browsing';

export const builtinTools: LobeBuiltinTool[] = [
  {
    identifier: ArtifactsManifest.identifier,
    manifest: ArtifactsManifest,
    type: 'builtin',
  },
  {
    hidden: true,
    identifier: SkillLoaderManifest.identifier,
    manifest: SkillLoaderManifest,
    type: 'builtin',
  },
  {
    identifier: DalleManifest.identifier,
    manifest: DalleManifest,
    type: 'builtin',
  },
  {
    hidden: true,
    identifier: WebBrowsingManifest.identifier,
    manifest: WebBrowsingManifest,
    type: 'builtin',
  },
  {
    // implicit tool: injected per-request when assistant memory is enabled,
    // never offered in the plugin picker
    hidden: true,
    identifier: MemoryManifest.identifier,
    manifest: MemoryManifest,
    type: 'builtin',
  },
  // Sandbox tools are not static: one per Sandbox Hub profile the user turned
  // on, appended after these by the tool store and the durable worker.
];

/** Current builtin identifiers plus retired ones still found on stored messages. */
export const builtinToolIdentifiers: ReadonlySet<string> = new Set([
  ...builtinTools.map((tool) => tool.identifier),
  SandboxIdentifier,
  ...Object.keys(LEGACY_BUILTIN_TOOL_ALIASES),
]);

/** Builtin tools, including every Sandbox profile identifier (`lobe-sandbox--<id>`). */
export const isBuiltinToolIdentifier = (identifier?: string | null) =>
  !!identifier && (builtinToolIdentifiers.has(identifier) || isSandboxToolIdentifier(identifier));
