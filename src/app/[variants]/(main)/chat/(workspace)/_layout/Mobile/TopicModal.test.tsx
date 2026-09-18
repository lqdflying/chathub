import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('React', React);

import TopicModal from './TopicModal';

vi.mock('@lobehub/ui', () => ({
  Modal: ({ children, destroyOnHidden, open }: any) => (
    <div data-destroy-on-hidden={destroyOnHidden ? 'true' : 'false'} data-testid="topic-modal">
      {open ? children : null}
    </div>
  ),
}));

vi.mock('@/hooks/useFetchTopics', () => ({
  useFetchTopics: () => undefined,
}));

vi.mock('@/hooks/useWorkspaceModal', () => ({
  useWorkspaceModal: (open: boolean) => [open, vi.fn()],
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: any) => unknown) =>
    selector({
      toggleMobileTopic: vi.fn(),
    }),
}));

vi.mock('@/store/global/selectors', () => ({
  systemStatusSelectors: {
    mobileShowTopic: () => false,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('mobile TopicModal', () => {
  it('does not keep topic list children when closed', () => {
    render(
      <TopicModal>
        <div data-testid="topic-list">topics</div>
      </TopicModal>,
    );

    expect(screen.queryByTestId('topic-list')).toBeNull();
    expect(screen.getByTestId('topic-modal').getAttribute('data-destroy-on-hidden')).toBe('true');
  });
});
