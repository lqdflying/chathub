import { render, screen } from '@testing-library/react';
import React, { type ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SettingsTabs } from '@/store/global/initialState';

import SettingsContent from './SettingsContent';

vi.stubGlobal('React', React);

const { dynamicLoaderState } = vi.hoisted(() => ({
  dynamicLoaderState: { nextIndex: 0 },
}));

vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<{ default: ComponentType }>) => {
    const loaderIndex = dynamicLoaderState.nextIndex;
    dynamicLoaderState.nextIndex += 1;

    const DynamicComponent = () => {
      void loader();
      return <div data-testid={`settings-component-${loaderIndex}`} />;
    };

    return DynamicComponent;
  },
}));

vi.mock('next/navigation', () => ({
  notFound: vi.fn(),
}));

vi.mock('react-layout-kit', () => ({
  Flexbox: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe('SettingsContent', () => {
  it('renders the dedicated page for the Chat Instruction tab', () => {
    render(<SettingsContent activeTab={SettingsTabs.ChatInstruction} mobile />);

    expect(screen.getByTestId('settings-component-1')).not.toBeNull();
    expect(screen.queryByTestId('settings-component-0')).toBeNull();
  });
});
