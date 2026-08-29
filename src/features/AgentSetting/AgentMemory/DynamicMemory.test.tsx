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

vi.mock('@/services/agent', () => ({
  agentService: {
    regenerateDreamMemory: vi.fn(),
  },
}));

import { AgentSettingsProvider } from '../AgentSettingsProvider';
import DynamicMemory from './DynamicMemory';

const Harness = ({
  initialMemory,
  onConfigChange,
}: {
  initialMemory: string;
  onConfigChange?: (next: string) => Promise<void> | void;
}) => {
  const [memory, setMemory] = useState(initialMemory);

  return (
    <ConfigProvider>
      <App>
        <AgentSettingsProvider
          config={{ assistantMemory: memory, id: 'agent-1' } as any}
          id={'session-1'}
          meta={{} as any}
          onConfigChange={async (next: any) => {
            setMemory(next.assistantMemory);
            await onConfigChange?.(next.assistantMemory);
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

  it('wraps legacy blobs and shows the empty hint when cleared', async () => {
  const user = userEvent.setup();
    const onConfigChange = vi.fn();

    render(
      <Harness initialMemory={'legacy prose only'} onConfigChange={onConfigChange} />,
    );

    expect(await screen.findByText('legacy prose only')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'settingChatMemory.clear' }));
    const modal = await screen.findByRole('dialog');
    await user.click(within(modal).getByRole('button', { name: 'settingChatMemory.clear' }));

    await waitFor(() => {
      expect(onConfigChange).toHaveBeenCalledWith('');
    });
    expect(await screen.findByText('settingChatMemory.dynamicMemory.empty')).toBeTruthy();
  });

  it('edits a card body and persists the updated document', async () => {
    const user = userEvent.setup();
    const onConfigChange = vi.fn();

    render(
      <Harness
        initialMemory={'#1 [2026-08-27]:\nPrefers concise answers'}
        onConfigChange={onConfigChange}
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
      expect(onConfigChange).toHaveBeenCalledWith('#1 [2026-08-27]:\nPrefers tables');
    });
  });
});
