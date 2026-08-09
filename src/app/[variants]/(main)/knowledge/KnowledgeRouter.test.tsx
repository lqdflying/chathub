import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import KnowledgeRouter from './KnowledgeRouter';

const { layoutState } = vi.hoisted(() => ({
  layoutState: {
    isMobile: false,
    pathname: '/knowledge',
    search: '',
  },
}));

vi.mock('antd', () => ({
  App: ({ children, style }: React.PropsWithChildren<{ style?: React.CSSProperties }>) => (
    <div data-testid="knowledge-root" style={style}>
      {children}
    </div>
  ),
  Drawer: ({ children, open }: React.PropsWithChildren<{ open?: boolean }>) =>
    open ? <div data-testid="knowledge-drawer">{children}</div> : null,
}));

vi.mock('antd-style', () => ({
  useTheme: () => ({ colorBorderSecondary: '#eee', colorBgContainerSecondary: '#fafafa' }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@lobehub/ui', () => ({
  ActionIcon: ({ 'aria-label': ariaLabel, onClick }: any) => (
    <button aria-label={ariaLabel} data-testid="navigation-toggle" onClick={onClick} type="button">
      menu
    </button>
  ),
}));

vi.mock('@lobehub/ui/mobile', () => {
  const ChatHeader = ({ left, right, center }: any) => (
    <div data-testid="chat-header">
      {left}
      {center}
      {right}
    </div>
  );
  ChatHeader.Title = ({ title }: { title?: string }) => <span>{title}</span>;
  return { ChatHeader };
});

vi.mock('react-responsive', () => ({
  useMediaQuery: () => layoutState.isMobile,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => layoutState.pathname,
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(layoutState.search),
}));

vi.mock('react-layout-kit', () => ({
  Flexbox: ({
    children,
    style,
    'data-testid': testId,
  }: React.PropsWithChildren<{ 'style'?: React.CSSProperties; 'data-testid'?: string }>) => (
    <div data-padding-bottom={style?.paddingBottom ?? ''} data-testid={testId} style={style}>
      {children}
    </div>
  ),
}));

vi.mock('./components/RagProviderBanner', () => ({
  default: () => <div data-testid="rag-banner" />,
}));

vi.mock('./routes/KnowledgeBaseDetail', () => ({
  default: ({ id, mobile }: { id: string; mobile?: boolean }) => (
    <div data-id={id} data-mobile={String(mobile)} data-testid="knowledge-detail" />
  ),
}));

vi.mock('./routes/KnowledgeBasesList', () => ({
  default: () => <div data-testid="knowledge-bases-list" />,
}));

vi.mock('./routes/KnowledgeHome', () => ({
  default: ({ mobile }: { mobile?: boolean }) => (
    <div data-mobile={String(mobile)} data-testid="knowledge-home" />
  ),
}));

vi.mock('./routes/KnowledgeHome/menu/FileMenu', () => ({
  default: ({ onSelect }: { onSelect?: () => void }) => (
    <div data-testid="file-menu" data-onselect={onSelect ? '1' : '0'} />
  ),
}));

vi.mock('./routes/KnowledgeHome/menu/KnowledgeBase', () => ({
  default: ({ onNavigate }: { onNavigate?: () => void }) => (
    <div data-testid="knowledge-base-menu" data-onnavigate={onNavigate ? '1' : '0'} />
  ),
}));

vi.mock('@/store/knowledgeBase', () => ({
  knowledgeBaseSelectors: { getKnowledgeBaseNameById: () => () => 'KB Name' },
  useKnowledgeBaseStore: () => 'KB Name',
}));

vi.mock('@/features/FileManager/Header/UploadFileButton', () => ({
  default: () => <div data-testid="upload-button" />,
}));

vi.mock('@/components/server/MobileNavLayout', () => ({
  default: ({ children, header, withNav }: any) => (
    <div data-withnav={String(!!withNav)} data-testid="mobile-content-layout">
      {header}
      {children}
    </div>
  ),
}));

vi.mock('./hooks/useFileCategory', () => ({
  useFileCategory: () => ['all'],
}));

beforeEach(() => {
  layoutState.isMobile = false;
  layoutState.pathname = '/knowledge';
  layoutState.search = '';
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('KnowledgeRouter', () => {
  it('renders a full-width root and the banner above a desktop workspace', () => {
    render(<KnowledgeRouter />);

    const root = screen.getByTestId('knowledge-root');
    expect(root.style.width).toBe('100%');
    expect(screen.getByTestId('rag-banner')).toBeTruthy();
    expect(screen.getByTestId('knowledge-home').getAttribute('data-mobile')).toBe('false');
  });

  it('renders the mobile shell with the banner and content for the home route', () => {
    layoutState.isMobile = true;

    render(<KnowledgeRouter />);

    expect(screen.getByTestId('mobile-content-layout').getAttribute('data-withnav')).toBe('true');
    expect(screen.getByTestId('knowledge-home').getAttribute('data-mobile')).toBe('true');
  });

  it('renders the drawer menus once the navigation button is opened', () => {
    layoutState.isMobile = true;

    render(<KnowledgeRouter />);

    expect(screen.queryByTestId('knowledge-drawer')).toBeNull();

    fireEvent.click(screen.getByTestId('navigation-toggle'));

    expect(screen.getByTestId('knowledge-drawer')).toBeTruthy();
    expect(screen.getByTestId('file-menu').getAttribute('data-onselect')).toBe('1');
    expect(screen.getByTestId('knowledge-base-menu').getAttribute('data-onnavigate')).toBe('1');
  });

  it('routes /knowledge/bases/:id to the detail page with the parsed id', () => {
    layoutState.isMobile = true;
    layoutState.pathname = '/knowledge/bases/kb-9';

    render(<KnowledgeRouter />);

    const detail = screen.getByTestId('knowledge-detail');
    expect(detail.getAttribute('data-id')).toBe('kb-9');
    expect(detail.getAttribute('data-mobile')).toBe('true');
  });
});
