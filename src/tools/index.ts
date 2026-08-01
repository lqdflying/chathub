import { LobeBuiltinTool } from '@lobechat/types';

import { isDesktop } from '@/const/version';

import { ArtifactsManifest } from './artifacts';
import { CodeInterpreterManifest } from './code-interpreter';
import { DalleManifest } from './dalle';
import { LocalSystemManifest } from './local-system';
import { MemoryManifest } from './memory';
import { MinimaxVisionManifest } from './minimax-vision';
import { WebBrowsingManifest } from './web-browsing';

export const builtinTools: LobeBuiltinTool[] = [
  {
    identifier: ArtifactsManifest.identifier,
    manifest: ArtifactsManifest,
    type: 'builtin',
  },
  {
    identifier: DalleManifest.identifier,
    manifest: DalleManifest,
    type: 'builtin',
  },
  {
    hidden: !isDesktop,
    identifier: LocalSystemManifest.identifier,
    manifest: LocalSystemManifest,
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
  {
    identifier: MinimaxVisionManifest.identifier,
    manifest: MinimaxVisionManifest,
    type: 'builtin',
  },
];
