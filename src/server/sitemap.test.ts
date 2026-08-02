// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { getCanonicalUrl } from '@/server/utils/url';

import { Sitemap, SitemapType } from './sitemap';

describe('Sitemap', () => {
  const sitemap = new Sitemap();

  it('advertises only the static page sitemap', () => {
    const index = sitemap.getIndex();

    expect(index).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(index).toContain(getCanonicalUrl(`/sitemap/${SitemapType.Pages}.xml`));
    expect(index).not.toContain('plugins-');
    expect(index).not.toContain('/discover');
  });

  it('omits Discover from the page sitemap', async () => {
    const pageSitemap = await sitemap.getPage();

    expect(pageSitemap).toContainEqual(
      expect.objectContaining({
        changeFrequency: 'monthly',
        priority: 0.4,
        url: getCanonicalUrl('/'),
      }),
    );
    expect(pageSitemap).toContainEqual(
      expect.objectContaining({
        changeFrequency: 'monthly',
        priority: 0.4,
        url: getCanonicalUrl('/chat'),
      }),
    );
    expect(pageSitemap.some(({ url }) => url.includes('/discover'))).toBe(false);
  });

  it('returns only supported sitemap references to robots.txt', () => {
    expect(sitemap.getRobots()).toEqual([
      getCanonicalUrl('/sitemap-index.xml'),
      getCanonicalUrl(`/sitemap/${SitemapType.Pages}.xml`),
    ]);
  });
});
