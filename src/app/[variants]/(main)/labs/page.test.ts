import { describe, expect, it, vi } from 'vitest';

import LabsRedirect from './page';

const redirect = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({ redirect }));

describe('Labs route', () => {
  it('redirects old bookmarks to Common settings', () => {
    LabsRedirect();

    expect(redirect).toHaveBeenCalledWith('/settings?active=common');
  });
});
