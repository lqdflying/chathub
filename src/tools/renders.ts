import { BuiltinRender } from '@lobechat/types';

import { DalleManifest } from './dalle';
import DalleRender from './dalle/Render';
import { MemoryManifest } from './memory';
import MemoryRender from './memory/Render';
import { LegacyCodeInterpreterIdentifier, SandboxManifest } from './sandbox';
import SandboxRender from './sandbox/Render';
import { SkillLoaderManifest } from './skills';
import SkillLoaderRender from './skills/Render';
import { WebBrowsingManifest } from './web-browsing';
import WebBrowsing from './web-browsing/Render';

export const BuiltinToolsRenders: Record<string, BuiltinRender> = {
  [DalleManifest.identifier]: DalleRender as BuiltinRender,
  [WebBrowsingManifest.identifier]: WebBrowsing as BuiltinRender,
  [SandboxManifest.identifier]: SandboxRender as BuiltinRender,
  // Code Interpreter messages from before the Sandbox rename.
  [LegacyCodeInterpreterIdentifier]: SandboxRender as BuiltinRender,
  [MemoryManifest.identifier]: MemoryRender as BuiltinRender,
  [SkillLoaderManifest.identifier]: SkillLoaderRender as BuiltinRender,
};
