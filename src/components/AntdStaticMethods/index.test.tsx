// EntryComponent.test.tsx
import { render } from '@testing-library/react';
import { App } from 'antd';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import EntryComponent, { message, modal, notification } from './index';

vi.stubGlobal('React', React);

const mockUseApp = {
  message: { error: vi.fn(), success: vi.fn() },
  modal: { confirm: vi.fn() },
  notification: { open: vi.fn() },
};

vi.mock('antd', () => ({
  App: {
    useApp: vi.fn(() => mockUseApp),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('EntryComponent', () => {
  it('should correctly initialize message, modal, and notification', () => {
    render(<EntryComponent />);

    // 验证 App.useApp 是否被调用
    expect(App.useApp).toHaveBeenCalled();

    // 验证 message, modal, 和 notification 是否被正确赋值
    expect(message).toBeDefined();
    expect(modal).toBeDefined();
    expect(notification).toBeDefined();

    // 验证是否赋值的对象与模拟的对象匹配
    expect(message).toEqual(mockUseApp.message);
    expect(modal).toEqual(mockUseApp.modal);
    expect(notification).toEqual(mockUseApp.notification);
  });

  it('should render without crashing', () => {
    const { container } = render(<EntryComponent />);
    expect(container).toBeDefined();
  });
});
