import { BuiltinToolState, initialBuiltinToolState } from './slices/builtin';
import { CustomPluginState, initialCustomPluginState } from './slices/customPlugin';
import { MCPStoreState, initialMCPStoreState } from './slices/mcpStore';
import { PluginStoreState, initialPluginStoreState } from './slices/oldStore';
import { PluginState, initialPluginState } from './slices/plugin';

export interface ToolScopeState {
  scopeGeneration: number;
}

export type ToolStoreState = PluginState &
  CustomPluginState &
  PluginStoreState &
  BuiltinToolState &
  MCPStoreState &
  ToolScopeState;

export const initialState: ToolStoreState = {
  scopeGeneration: 0,
  ...initialPluginState,
  ...initialCustomPluginState,
  ...initialPluginStoreState,
  ...initialBuiltinToolState,
  ...initialMCPStoreState,
};
