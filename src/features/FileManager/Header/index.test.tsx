import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import Header from './index';

vi.mock('@lobehub/ui/chat', () => ({
  ChatHeader: ({ left, right }: any) => (
    <div data-testid="chat-header">
      <div data-testid="header-left">{left}</div>
      <div data-testid="header-right">{right ?? 'no-right'}</div>
    </div>
  ),
}));

vi.mock('./FilesSearchBar', () => ({
  default: ({ mobile }: { mobile?: boolean }) => (
    <div data-mobile={String(!!mobile)} data-testid="search-bar" />
  ),
}));

vi.mock('./TogglePanelButton', () => ({
  default: () => <div data-testid="toggle-panel" />,
}));

const uploadMocks = vi.hoisted(() => ({ mounted: 0 }));

vi.mock('./UploadFileButton', () => ({
  default: ({ mobile }: { mobile?: boolean }) => {
    uploadMocks.mounted += 1;
    return (
      <div data-mobile={String(!!mobile)} data-testid="upload-button">
        upload
      </div>
    );
  },
}));

beforeEach(() => {
  uploadMocks.mounted = 0;
});

describe('FileManager Header upload ownership', () => {
  it('renders the upload button on desktop', () => {
    render(<Header knowledgeMode />);

    expect(screen.getByTestId('upload-button')).toBeTruthy();
    expect(screen.getByTestId('toggle-panel')).toBeTruthy();
    expect(screen.getByTestId('search-bar').getAttribute('data-mobile')).toBe('false');
  });

  it('omits the upload button on mobile so the shell is the single owner', () => {
    render(<Header knowledgeMode mobile />);

    expect(screen.queryByTestId('upload-button')).toBeNull();
    expect(uploadMocks.mounted).toBe(0);
    expect(screen.getByTestId('search-bar').getAttribute('data-mobile')).toBe('true');
    expect(screen.queryByTestId('toggle-panel')).toBeNull();
  });
});
