import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App, ConfigProvider } from 'antd';
import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('React', React);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (!params) return key;
      if ('reason' in params || Object.keys(params).some((k) => k !== 'ns')) {
        return `${key} ${JSON.stringify(params)}`;
      }
      return key;
    },
  }),
}));

vi.mock('@/features/AgentSetting/AgentPrompt/TokenTag', () => ({ default: () => null }));

const {
  clearDreamMemory,
  deleteDreamMemoryCard,
  regenerateDreamMemory,
  updateDreamMemoryCard,
} = vi.hoisted(() => ({
  clearDreamMemory: vi.fn(),
  deleteDreamMemoryCard: vi.fn(),
  regenerateDreamMemory: vi.fn(),
  updateDreamMemoryCard: vi.fn(),
}));

vi.mock('@/services/agent', () => ({
  agentService: {
    clearDreamMemory,
    deleteDreamMemoryCard,
    regenerateDreamMemory,
    updateDreamMemoryCard,
  },
}));

import { AgentSettingsProvider } from '../AgentSettingsProvider';
import DynamicMemory from './DynamicMemory';

const Harness = ({
  initialMemory,
  onRefreshConfig,
}: {
  initialMemory: string;
  onRefreshConfig?: () => Promise<void> | void;
}) => {
  const [memory, setMemory] = useState(initialMemory);

  return (
    <ConfigProvider>
      <App>
        <AgentSettingsProvider
          config={{ assistantMemory: memory, id: 'agent-1' } as any}
          id={'session-1'}
          meta={{} as any}
          onRefreshConfig={async () => {
            await onRefreshConfig?.();
          }}
        >
          <DynamicMemory />
        </AgentSettingsProvider>
      </App>
    </ConfigProvider>
  );
};

describe('DynamicMemory cards', () => {
  it('renders dated dream cards from the document', async () => {
    render(
      <Harness initialMemory={'#1 [2026-08-27]:\nPrefers concise answers'} />,
    );

    expect(await screen.findByText('Prefers concise answers')).toBeTruthy();
    expect(screen.getByText('2026-08-27')).toBeTruthy();
    expect(screen.getByText('#1')).toBeTruthy();
  });

  it('clears via the server mutation and refreshes config', async () => {
    const user = userEvent.setup();
    const onRefreshConfig = vi.fn(async () => undefined);
    clearDreamMemory.mockResolvedValue({ status: 'success' });

    render(
      <Harness
        initialMemory={'#1 [2026-08-27]:\nPrefers concise answers'}
        onRefreshConfig={onRefreshConfig}
      />,
    );

    await screen.findByText('Prefers concise answers');
    await user.click(screen.getByRole('button', { name: 'settingChatMemory.clear' }));
    const modal = await screen.findByRole('dialog');
    await user.click(within(modal).getByRole('button', { name: 'settingChatMemory.clear' }));

    await waitFor(() => {
      expect(clearDreamMemory).toHaveBeenCalledWith({ agentId: 'agent-1' });
      expect(onRefreshConfig).toHaveBeenCalled();
    });
  });

  it('edits a card through the server mutation', async () => {
    const user = userEvent.setup();
    const onRefreshConfig = vi.fn(async () => undefined);
    updateDreamMemoryCard.mockResolvedValue({ status: 'success' });

    render(
      <Harness
        initialMemory={'#1 [2026-08-27]:\nPrefers concise answers'}
        onRefreshConfig={onRefreshConfig}
      />,
    );

    await screen.findByText('Prefers concise answers');
    const iconButtons = screen.getAllByRole('button').slice(0, 3);
    await user.click(iconButtons[1]!);
    const editor = screen.getByDisplayValue('Prefers concise answers');
    await user.clear(editor);
    await user.type(editor, 'Prefers tables');
    await user.click(screen.getByRole('button', { name: 'ok' }));

    await waitFor(() => {
      expect(updateDreamMemoryCard).toHaveBeenCalledWith({
        agentId: 'agent-1',
        body: 'Prefers tables',
        dateTag: '2026-08-27',
        index: 1,
        match: 'Prefers concise answers',
      });
      expect(onRefreshConfig).toHaveBeenCalled();
    });
  });

  it('refreshes after a failed card edit', async () => {
    const user = userEvent.setup();
    const onRefreshConfig = vi.fn(async () => undefined);
    updateDreamMemoryCard.mockResolvedValue({ reason: 'mismatch', status: 'failed' });

    render(
      <Harness
        initialMemory={'#1 [2026-08-27]:\nPrefers concise answers'}
        onRefreshConfig={onRefreshConfig}
      />,
    );

    await screen.findByText('Prefers concise answers');
    const iconButtons = screen.getAllByRole('button').slice(0, 3);
    await user.click(iconButtons[1]!);
    const editor = screen.getByDisplayValue('Prefers concise answers');
    await user.clear(editor);
    await user.type(editor, 'Prefers tables');
    await user.click(screen.getByRole('button', { name: 'ok' }));

    await waitFor(() => {
      expect(onRefreshConfig).toHaveBeenCalled();
    });
  });
});
