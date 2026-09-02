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

const mocks = vi.hoisted(() => ({
  config: { enableReasoning: true } as Record<string, unknown>,
  extendParams: [
    'enableReasoning',
    'zhipuPreservedThinking',
    'zhipuReasoningEffort',
  ] as string[],
  model: 'glm-5.2',
}));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: unknown) => unknown) =>
    selector({ updateAgentChatConfig }),
}));

vi.mock('@/store/agent/selectors', () => ({
  agentChatConfigSelectors: { currentChatConfig: () => mocks.config },
  agentSelectors: {
    currentAgentModel: () => mocks.model,
    currentAgentModelProvider: () => 'zhipu',
  },
}));

vi.mock('@/store/aiInfra', () => ({
  aiModelSelectors: {
    modelExtendParams: () => () => mocks.extendParams,
  },
  useAiInfraStore: (selector: (state: unknown) => unknown) => selector({}),
}));

import ZhipuOptions from './ZhipuOptions';

describe('ZhipuOptions switch-row tooltips', () => {
  beforeEach(() => {
    mocks.model = 'glm-5.2';
    mocks.extendParams = [
      'enableReasoning',
      'zhipuPreservedThinking',
      'zhipuReasoningEffort',
    ];
    mocks.config = { enableReasoning: true };
    updateAgentChatConfig.mockClear();
  });
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

  it('forced-thinking GLM-5.3 shows Low/High/Max without a reasoning switch', () => {
    mocks.model = 'glm-5.3';
    mocks.extendParams = ['zhipuReasoningEffort', 'zhipuPreservedThinking'];
    mocks.config = {};

    const { container } = render(
      <ConfigProvider>
        <ZhipuOptions />
      </ConfigProvider>,
    );

    expect(screen.queryByText('extendParams.zhipuReasoning.title')).toBeNull();
    expect(screen.getByText('extendParams.zhipuReasoningEffort.low')).toBeTruthy();
    expect(screen.getByText('extendParams.zhipuReasoningEffort.high')).toBeTruthy();
    expect(screen.getByText('extendParams.zhipuReasoningEffort.max')).toBeTruthy();
    expect(screen.queryByText('extendParams.zhipuReasoningEffort.skip')).toBeNull();
    expect(container.querySelectorAll('.ant-switch')).toHaveLength(1);
  });
});
