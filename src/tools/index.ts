import { LobeBuiltinTool } from '@lobechat/types';

import { ArtifactsManifest } from './artifacts';
import { CodeInterpreterManifest } from './code-interpreter';
import { DalleManifest } from './dalle';
import { MemoryManifest } from './memory';
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
  {
    identifier: CodeInterpreterManifest.identifier,
    manifest: CodeInterpreterManifest,
    type: 'builtin',
  },
];
