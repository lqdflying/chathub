import { act, render, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentStore } from '@/store/agent';
import { useSessionStore } from '@/store/session';

vi.stubGlobal('React', React);

vi.mock('@lobehub/ui', () => ({
  Drawer: ({ children, open }: { children?: React.ReactNode; open?: boolean }) =>
    open ? <div data-testid="agent-settings-drawer">{children}</div> : null,
}));

vi.mock('@/features/AgentSetting', () => ({
  AgentCategory: () => null,
  AgentSettings: () => <div>settings</div>,
}));

vi.mock('@/features/AgentSetting/AgentSettingsProvider', () => ({
  AgentSettingsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/BrandWatermark', () => ({ default: () => null }));
vi.mock('@/components/PanelTitle', () => ({ default: () => null }));
vi.mock('@/features/Setting/Footer', () => ({ default: () => null }));
vi.mock('@/hooks/useInitAgentConfig', () => ({
  useInitAgentConfig: () => ({ isLoading: false }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('workspace AgentSettings drawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({ activeId: 'session-id' } as any);
    useAgentStore.setState({
      agentMap: {},
      showAgentSetting: false,
    } as any);
  });

  it('refreshes agent config when the drawer opens', async () => {
    const refresh = vi.fn(async () => undefined);
    useAgentStore.setState({
      internal_refreshAgentConfig: refresh,
    } as any);

    const AgentSettings = (await import('./index')).default;
    const { rerender } = render(<AgentSettings open={false} />);

    expect(refresh).not.toHaveBeenCalled();

    await act(async () => {
      rerender(<AgentSettings open />);
    });

    await waitFor(() => {
      expect(refresh).toHaveBeenCalledWith('session-id');
    });
  });
});
