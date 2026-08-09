import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import FileManager from './index';

vi.mock('@lobehub/ui', () => ({
  Text: ({ children }: React.PropsWithChildren) => <span>{children}</span>,
}));

vi.mock('next/dynamic', () => ({
  __esModule: true,
  default: () => () => <div data-testid="chunk-drawer" />,
}));

vi.mock('./Header', () => ({
  default: ({ mobile }: { mobile?: boolean }) => (
    <div data-mobile={String(!!mobile)} data-testid="file-manager-header" />
  ),
}));

vi.mock('./FileList', () => ({
  default: ({ mobile, category, title }: any) => (
    <div
      data-category={category ?? ''}
      data-mobile={String(!!mobile)}
      data-testid="file-list"
      title={title}
    />
  ),
}));

vi.mock('./UploadDock', () => ({ default: () => <div data-testid="upload-dock" /> }));

describe('FileManager compact mode', () => {
  it('renders the mobile header and hides the duplicate title on mobile', () => {
    render(<FileManager knowledgeMode mobile title="All Files" />);

    expect(screen.getByTestId('file-manager-header').getAttribute('data-mobile')).toBe('true');
    expect(screen.getByTestId('file-list').getAttribute('data-mobile')).toBe('true');
    expect(screen.queryByText('All Files')).toBeNull();
  });

  it('renders the desktop header, duplicate title, and desktop file list by default', () => {
    render(<FileManager knowledgeMode title="All Files" />);

    expect(screen.getByTestId('file-manager-header').getAttribute('data-mobile')).toBe('false');
    expect(screen.getByTestId('file-list').getAttribute('data-mobile')).toBe('false');
    expect(screen.getByText('All Files')).toBeTruthy();
  });

  it('threads the category into the file list', () => {
    render(<FileManager category="images" knowledgeMode mobile title="Images" />);

    expect(screen.getByTestId('file-list').getAttribute('data-category')).toBe('images');
  });
});
