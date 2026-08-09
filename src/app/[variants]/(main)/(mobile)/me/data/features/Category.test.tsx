import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';

import { HardDriveDownload, HardDriveUpload } from 'lucide-react';

import Category from './Category';

const mocks = vi.hoisted(() => ({
  Cell: vi.fn(function Cell({ label, onClick }: any) {
    return <div>{label}</div>;
  }),
  DataImporter: vi.fn(function DataImporter({ children }: any) {
    return <span>{children}</span>;
  }),
  exportAll: vi.fn().mockResolvedValue(undefined),
  messageError: vi.fn(),
}));

vi.mock('@/components/Cell', () => ({ default: mocks.Cell }));
vi.mock('@/features/DataImporter', () => ({ default: mocks.DataImporter }));
vi.mock('@/services/config', () => ({ configService: { exportAll: mocks.exportAll } }));
vi.mock('antd', () => ({
  App: { useApp: () => ({ message: { error: mocks.messageError } }) },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.stubGlobal('React', React);

describe('mobile Data Storage Category', () => {
  beforeEach(() => {
    mocks.Cell.mockClear();
    mocks.DataImporter.mockClear();
    mocks.exportAll.mockClear();
    mocks.messageError.mockClear();
  });

  it('renders compact setting-namespace labels with matched transfer icons', () => {
    render(<Category />);

    const exportRow = mocks.Cell.mock.calls.find((c) => c[0].icon === HardDriveUpload)![0];
    const importRow = mocks.Cell.mock.calls.find((c) => c[0].icon === HardDriveDownload)![0];

    expect(exportRow.label).toBe('storage.actions.export.title');
    expect(importRow.icon).toBe(HardDriveDownload);
    expect(mocks.DataImporter).toHaveBeenCalledTimes(1);
    expect(mocks.DataImporter.mock.calls[0][0].children).toBe('storage.actions.import.title');
  });

  it('does not use the legacy long exportType.all or importData labels', () => {
    render(<Category />);

    const labels = mocks.Cell.mock.calls.map((c) => c[0].label);
    expect(labels).not.toContain('exportType.all');
    expect(labels).not.toContain('importData');
  });

  it('invokes configService.exportAll when the export row is clicked', async () => {
    render(<Category />);

    const exportRow = mocks.Cell.mock.calls.find((c) => c[0].icon === HardDriveUpload)![0];
    await exportRow.onClick();

    expect(mocks.exportAll).toHaveBeenCalledTimes(1);
  });

  it('renders a divider between the export and import rows', () => {
    render(<Category />);

    const divider = mocks.Cell.mock.calls.find((c) => c[0].type === 'divider');
    expect(divider).toBeTruthy();
  });
});
