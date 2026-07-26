import { SessionState, initialSessionState } from './slices/session/initialState';
import { SessionGroupState, initSessionGroupState } from './slices/sessionGroup/initialState';

export interface SessionStoreState extends SessionGroupState, SessionState {
  scopeGeneration: number;
}

export const initialState: SessionStoreState = {
  ...initSessionGroupState,
  ...initialSessionState,
  scopeGeneration: 0,
};
