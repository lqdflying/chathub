import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfigProvider } from 'antd';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('React', React);

vi.mock('antd-style', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd-style')>();
  return {
    ...actual,
    useTheme: () => ({ colorTextTertiary: '#999' }),
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const updateAgentChatConfig = vi.fn();

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: unknown) => unknown) =>
    selector({ updateAgentChatConfig }),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentChatConfigSelectors: { currentChatConfig: () => ({ enableReasoning: true }) },
  agentSelectors: {
    currentAgentModel: () => 'glm-5.2',
    currentAgentModelProvider: () => 'zhipu',
  },
}));

vi.mock('@/store/aiInfra', () => ({
  aiModelSelectors: {
    modelExtendParams: () => () => [
      'enableReasoning',
      'zhipuPreservedThinking',
      'zhipuReasoningEffort',
    ],
  },
  useAiInfraStore: (selector: (state: unknown) => unknown) => selector({}),
}));

import ZhipuOptions from './ZhipuOptions';

describe('ZhipuOptions switch-row tooltips', () => {
  it('switch rows use the native Form tooltip; hover/click open it without toggling the switch', async () => {
    const user = userEvent.setup();

    const { container } = render(
      <ConfigProvider>
        <ZhipuOptions />
      </ConfigProvider>,
    );

    // both switch rows (reasoning, preserved thinking) carry the native
    // Form.Item tooltip icon, which the global switch-label CSS re-enables
    const nativeTooltips = container.querySelectorAll('.ant-form-item-tooltip');
    expect(nativeTooltips).toHaveLength(2);

    // the non-switch Segmented row keeps the shared InfoTooltip
    expect(container.querySelectorAll('.chathub-form-label-tooltip')).toHaveLength(1);

    const reasoningSwitch = screen.getAllByRole('switch')[0];
    // bound from initialValues config (enableReasoning: true)
    expect(reasoningSwitch.getAttribute('aria-checked')).toBe('true');

    const icon = nativeTooltips[0] as HTMLElement;

    await user.hover(icon);
    await waitFor(() => {
      expect(screen.getByText('extendParams.zhipuReasoning.desc')).toBeTruthy();
    });
    await user.unhover(icon);

    await user.click(icon);
    await waitFor(() => {
      expect(screen.getByText('extendParams.zhipuReasoning.desc')).toBeTruthy();
    });

    // clicking the help icon must never activate the associated switch
    expect(reasoningSwitch.getAttribute('aria-checked')).toBe('true');
    expect(updateAgentChatConfig).not.toHaveBeenCalled();
  });
});
