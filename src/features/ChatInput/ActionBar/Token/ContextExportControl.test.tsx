import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatStore } from '@/store/chat';
import { initialContextExportState } from '@/store/chat/slices/contextExport/initialState';

import ContextExportControl from './ContextExportControl';

const { copyToClipboard, exportFile, messageSuccess } = vi.hoisted(() => ({
  copyToClipboard: vi.fn(),
  exportFile: vi.fn(),
  messageSuccess: vi.fn(),
}));

vi.stubGlobal('React', React);

vi.mock('@lobechat/utils/client', () => ({
  exportFile,
}));

vi.mock('@lobehub/ui', () => ({
  Highlighter: ({ children }: { children: React.ReactNode }) => <pre>{children}</pre>,
  copyToClipboard,
}));

vi.mock('@/hooks/useIsMobile', () => ({
  useIsMobile: () => false,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('antd-style', () => ({
  createStyles: () => () => ({
    styles: {
      allocation: 'allocation',
      allocationItem: 'allocationItem',
      code: 'code',
      drawerBody: 'drawerBody',
      label: 'label',
      metadata: 'metadata',
      sectionTitle: 'sectionTitle',
      summary: 'summary',
      value: 'value',
    },
  }),
}));

vi.mock('antd', () => ({
  Alert: ({ message }: { message: React.ReactNode }) => <div role="alert">{message}</div>,
  App: {
    useApp: () => ({ message: { success: messageSuccess } }),
  },
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children: React.ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button disabled={disabled} onClick={onClick} type="button">
      {children}
    </button>
  ),
  Drawer: ({
    children,
    footer,
    open,
    title,
  }: {
    children: React.ReactNode;
    footer: React.ReactNode;
    open: boolean;
    title: React.ReactNode;
  }) =>
    open ? (
      <section aria-label={String(title)}>
        {children}
        {footer}
      </section>
    ) : null,
  Empty: ({ description }: { description: React.ReactNode }) => <div>{description}</div>,
  Segmented: ({
    onChange,
    options,
  }: {
    onChange: (value: string) => void;
    options: { label: React.ReactNode; value: string }[];
  }) => (
    <div>
      {options.map((option) => (
        <button key={option.value} onClick={() => onChange(option.value)} type="button">
          {option.label}
        </button>
      ))}
    </div>
  ),
  Select: ({
    onChange,
    options,
    value,
  }: {
    onChange: (value: string) => void;
    options: { label: React.ReactNode; value: string }[];
    value?: string;
  }) => (
    <select onChange={(event) => onChange(event.target.value)} value={value}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
  Tag: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

describe('ContextExportControl', () => {
  beforeEach(() => {
    useChatStore.setState(initialContextExportState);
    vi.clearAllMocks();
  });

  it('arms and cancels the next capture with the displayed allocation', () => {
    render(
      <ContextExportControl
        allocation={{ chatInstruction: 10, chatMessages: 30, roleSettings: 5, total: 45 }}
      />,
    );

    fireEvent.click(screen.getByText('contextExport.exportNext'));

    expect(useChatStore.getState().contextExportCaptureStatus).toBe('armed');
    expect(useChatStore.getState().contextExportAllocation).toEqual({
      chatInstruction: 10,
      chatMessages: 30,
      roleSettings: 5,
      total: 45,
    });

    fireEvent.click(screen.getByText('contextExport.cancelCapture'));

    expect(useChatStore.getState().contextExportCaptureStatus).toBe('idle');
    expect(useChatStore.getState().contextExportAllocation).toBeUndefined();
  });

  it('previews, copies, and downloads a completed capture', async () => {
    render(
      <ContextExportControl
        allocation={{ chatInstruction: 10, chatMessages: 30, roleSettings: 5, total: 45 }}
      />,
    );

    act(() => {
      const store = useChatStore.getState();
      store.armContextExport({
        chatInstruction: 10,
        chatMessages: 30,
        roleSettings: 5,
        total: 45,
      });
      const captureId = store.consumeContextExportArm()!;
      const request = useChatStore.getState().createContextExportRequest(captureId, 'assistant')!;
      useChatStore.getState().appendContextExportSnapshot({
        ...request,
        allocation: { ...request.allocation!, knowledgeBase: 12, total: 57 },
        engineeredInput: { messages: ['engineered'] },
        knowledgeBase: {
          diagnosticId: 'kb_1234567890abcdef',
          promptTokens: 12,
          queryRewritten: true,
          retrieval: {
            candidateCount: 2,
            candidateLimit: 24,
            eligibleCount: 1,
            minimumSimilarity: 0.2,
            resultLimit: 8,
            selectedCount: 1,
            selectedScores: [0.9],
            strategy: 'cosine',
          },
          scope: { directFileCount: 1, expandedFileCount: 2, knowledgeBaseCount: 1 },
        },
        metadata: { model: 'test-model', provider: 'test-provider' },
        providerRequest: { input: ['provider-ready'] },
        redactions: ['transportOptions'],
        status: 'complete',
      });
      useChatStore.getState().completeContextExport();
    });

    fireEvent.click(screen.getByText('contextExport.viewCaptured'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'contextExport.engineeredContext' })).toBeTruthy();
      expect(screen.getByText(/"engineered"/)).toBeTruthy();
      expect(screen.getByText('contextExport.knowledgeBaseSummary')).toBeTruthy();
      expect(screen.getByText(/kb_1234567890abcdef/)).toBeTruthy();
    });

    fireEvent.click(screen.getByText('contextExport.providerRequest'));
    expect(screen.getByText(/provider-ready/)).toBeTruthy();

    fireEvent.click(screen.getByText('contextExport.copyLayer'));
    expect(copyToClipboard).toHaveBeenCalledWith(
      JSON.stringify({ input: ['provider-ready'] }, null, 2),
    );
    await waitFor(() => {
      expect(messageSuccess).toHaveBeenCalledWith('contextExport.copySuccess');
    });

    fireEvent.click(screen.getByText('contextExport.downloadBatch'));
    const batch = useChatStore.getState().contextExportBatch;
    expect(exportFile).toHaveBeenCalledWith(
      JSON.stringify(batch, null, 2),
      expect.stringMatching(/^chathub-context-.+\.json$/),
    );
  });
});
