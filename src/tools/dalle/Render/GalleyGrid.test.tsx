import { render } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import GalleyGrid from './GalleyGrid';

vi.mock('antd-style', async (importOriginal) => ({
  ...(await importOriginal<typeof import('antd-style')>()),
  useResponsive: () => ({ mobile: false }),
}));

// Grid just renders its children so we can observe the props each item receives.
vi.mock('@/components/GalleyGrid/Grid', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe('GalleyGrid', () => {
  it('assigns global indices 0..3 across both rows of a 4-image gallery (finding r1/5)', () => {
    const seen: number[] = [];
    const Render = (props: { index: number }) => {
      seen.push(props.index);
      return <div data-testid={`item-${props.index}`} />;
    };

    render(<GalleyGrid items={[{}, {}, {}, {}]} renderItem={Render} />);

    // the bottom row must NOT restart at 0 — items keep the global index that
    // loading/error state is keyed on
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });
});
